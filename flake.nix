{
  description = "Nightwatch Radio — AI-powered personal internet radio station";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          name = "airadio-dev";

          packages = with pkgs; [
            # playback / streaming
            liquidsoap
            icecast
            mpv # for testing the icecast stream from the shell

            # app stack
            nodejs_22
            pnpm
            sqlite

            # audio tooling (duration probing on upload, etc.)
            ffmpeg
          ];

          shellHook = ''
            echo "airadio devShell — liquidsoap $(liquidsoap --version | head -n1), node $(node --version), pnpm $(pnpm --version)"
          '';
        };
      });
}
