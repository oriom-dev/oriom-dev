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
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 artPython pkgs.potrace pkgs.libcoap ];
        };
      });
}
