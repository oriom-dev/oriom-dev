# NixOS module: the oriom.dev server in a Podman container, behind Caddy.
#   HTTP/1.0–3  Caddy (TLS, h2, h3) -> 127.0.0.1:${port}
#   HTTP/0.9    caddy-l4 on :80 sends non-HTTP/1.x requests -> 127.0.0.1:${http09Port}
#   CoAP        UDP ${coapPort}, published directly
self:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.oriom-dev;
  app = "${cfg.package}/lib/oriom-dev";
in
{
  options.services.oriom-dev = {
    enable = lib.mkEnableOption "oriom.dev portfolio";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "Built site and server.";
    };
    domain = lib.mkOption { type = lib.types.str; default = "oriom.dev"; };
    image = lib.mkOption {
      type = lib.types.str;
      default = "docker.io/library/node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5";
      description = "Node.js runtime image, pinned by digest. The app itself is mounted read-only from the Nix store.";
    };
    port = lib.mkOption { type = lib.types.port; default = 3020; description = "Loopback HTTP port Caddy proxies to."; };
    http09Port = lib.mkOption { type = lib.types.port; default = 3021; description = "Loopback port for HTTP/0.9 (PROXY protocol v2 from caddy-l4)."; };
    coapPort = lib.mkOption { type = lib.types.nullOr lib.types.port; default = 5683; description = "Public UDP port for CoAP; null disables it."; };
    caddyLayer4 = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Route HTTP/0.9 on :80 with caddy-l4. Requires services.caddy.package built with github.com/mholt/caddy-l4.";
    };
    agentSocket = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/cluster-dashboard/agent.sock";
      description = "Cluster dashboard agent socket; only an allowlisted summary of it is published.";
    };
    agentGid = lib.mkOption { type = lib.types.nullOr lib.types.int; default = null; description = "Group that may read the agent socket."; };
  };

  config = lib.mkIf cfg.enable {
    systemd.tmpfiles.rules = [ "d /var/lib/oriom-dev 0750 65534 ${toString (if cfg.agentGid == null then 65534 else cfg.agentGid)} -" ];

    virtualisation.oci-containers.containers.oriom-dev = {
      inherit (cfg) image;
      cmd = [ "node" "/app/src/server/main.ts" ];
      ports = [
        "127.0.0.1:${toString cfg.port}:8080/tcp"
        "127.0.0.1:${toString cfg.http09Port}:8091/tcp"
      ] ++ lib.optionals (cfg.coapPort != null) [ "${toString cfg.coapPort}:5683/udp" ];
      volumes = [ "${app}:/app:ro" "/var/lib/oriom-dev:/state" ]
        ++ lib.optional (cfg.agentSocket != null) "${dirOf cfg.agentSocket}:${dirOf cfg.agentSocket}:ro";
      environment = {
        NODE_ENV = "production";
        LISTEN = "0.0.0.0:8080";
        HTTP09_LISTEN = "0.0.0.0:8091";
        STATE_DIR = "/state";
      } // lib.optionalAttrs (cfg.coapPort != null) { COAP_PORT = "5683"; }
        // lib.optionalAttrs (cfg.agentSocket != null) { CLUSTER_AGENT_SOCKET = cfg.agentSocket; };
      extraOptions = [
        "--read-only"
        "--user=65534:${toString (if cfg.agentGid == null then 65534 else cfg.agentGid)}"
        "--cap-drop=ALL"
        "--security-opt=no-new-privileges"
        "--pids-limit=128"
        "--memory=256m"
        "--cpus=0.5"
        "--log-driver=journald"
      ];
    };

    networking.firewall.allowedUDPPorts = lib.optional (cfg.coapPort != null) cfg.coapPort;

    services.caddy.virtualHosts = {
      # Plain HTTP is served, not redirected: .dev is HSTS-preloaded, so browsers use
      # HTTPS anyway, and HTTP/1.0 clients without TLS can still read the site.
      "${cfg.domain}, http://${cfg.domain}".extraConfig = ''
        encode zstd gzip
        reverse_proxy 127.0.0.1:${toString cfg.port}
      '';
      "www.${cfg.domain}".extraConfig = ''
        redir https://${cfg.domain}{uri} permanent
      '';
    };

    # HTTP/0.9: a request line without a version is not HTTP/1.x, so caddy-l4's `http`
    # matcher rejects it and it goes to the app (PROXY v2 keeps the client address).
    # Every HTTP/1.x request, ACME challenges included, falls through to Caddy as before.
    services.caddy.globalConfig = lib.mkIf cfg.caddyLayer4 ''
      servers :80 {
        listener_wrappers {
          layer4 {
            @http09 not http
            route @http09 {
              proxy {
                proxy_protocol v2
                upstream 127.0.0.1:${toString cfg.http09Port}
              }
            }
          }
        }
      }
    '';
  };
}
