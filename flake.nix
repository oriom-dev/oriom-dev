{
  description = "oriom.dev: one request, under 512 KB, three dimensions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        # Only for tools/lineart: turning logos and screenshots into one-stroke paths.
        # Its output is committed, so building the site never needs Python.
        artPython = pkgs.python3.withPackages (ps: with ps; [ pillow numpy opencv4 scikit-image cairosvg ]);
      in {
        # The built site (dist/) plus the server and its runtime dependencies only.
        packages.default = pkgs.buildNpmPackage {
          pname = "oriom-dev";
          version = self.shortRev or self.dirtyShortRev or "dev";
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [ ./package.json ./package-lock.json ./tsconfig.json ./src ./content ./test ];
          };
          nodejs = pkgs.nodejs_24;
          npmDepsHash = "sha256-ck7IV/USX2y2k+DT6q2kTdS+m1ARm8s3ZlPjIixKMK0=";
          npmFlags = [ "--ignore-scripts" ];
          doCheck = true;
          checkPhase = "npm test";
          installPhase = ''
            runHook preInstall
            npm prune --omit=dev --ignore-scripts
            mkdir -p $out/lib/oriom-dev
            cp -r dist src content package.json node_modules $out/lib/oriom-dev/
            runHook postInstall
          '';
        };

        # The OGP images' fonts: Noto Sans CJK JP, two weights, Japanese only, TrueType
        # (tools/ogfont.py). Slow to make (minutes), so a package of its own: cached.
        packages.ogFonts = pkgs.runCommand "oriom-dev-og-fonts" {
          nativeBuildInputs = [ (pkgs.python3.withPackages (ps: [ ps.fonttools ])) ];
        } ''
          mkdir -p $out
          python3 ${./tools/ogfont.py} ${pkgs.noto-fonts-cjk-sans}/share/fonts/opentype/noto-cjk/NotoSansCJK-VF.otf.ttc $out
        '';

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 artPython pkgs.potrace pkgs.libcoap ];
          OGP_FONTS = self.packages.${system}.ogFonts;
        };
      }) // {
        nixosModules.default = import ./nix/module.nix self;
      };
}
