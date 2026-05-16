{
  description = "IqV - Voice AI pipeline with Pipecat";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        python = pkgs.python312;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            python
            pkgs.uv
            pkgs.black

            # audio I/O (pyaudio / sounddevice)
            pkgs.portaudio
            pkgs.ffmpeg

            # native build deps (tokenizers, numpy, etc.)
            pkgs.gcc
            pkgs.pkg-config
            pkgs.openssl
            pkgs.zlib
            pkgs.stdenv.cc.cc.lib
          ];

          env = {
            # 共有ライブラリのパスを通す (portaudio など)
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
              pkgs.portaudio
              pkgs.stdenv.cc.cc.lib
              pkgs.zlib
            ];
          };

          shellHook = ''
            if [ ! -d .venv ]; then
              echo "[nix] Creating virtual environment..."
              uv venv --python ${python}/bin/python
            fi
            export VIRTUAL_ENV="$PWD/.venv"
            export PATH="$VIRTUAL_ENV/bin:$PATH"
            unset UV_PYTHON
            echo "[nix] IqV dev shell ready. Run: uv pip install \"pipecat-ai[...]\""
          '';
        };
      }
    );
}
