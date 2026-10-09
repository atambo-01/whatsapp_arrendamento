#!/bin/sh
# Prepara o proxy: descarrega wireproxy e wgcf, regista uma conta gratuita do
# Cloudflare WARP e gera wireproxy.conf. Idempotente: não repete o que já existe.
set -eu
cd "$(dirname "$0")/.."
mkdir -p .bin

if [ ! -x .bin/wireproxy ]; then
  echo "» a descarregar wireproxy"
  curl -fsSL "${WIREPROXY_URL:-https://github.com/windtf/wireproxy/releases/latest/download/wireproxy_linux_amd64.tar.gz}" \
    | tar xz -C .bin wireproxy
fi

if [ -f wireproxy.conf ] && ! grep -q '<' wireproxy.conf; then
  echo "» wireproxy.conf já configurado"
  exit 0
fi

if [ ! -x .bin/wgcf ]; then
  echo "» a descarregar wgcf"
  tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/ViRb3/wgcf/releases/latest)
  ver=${tag##*/v}
  curl -fsSL -o .bin/wgcf "https://github.com/ViRb3/wgcf/releases/download/v${ver}/wgcf_${ver}_linux_amd64"
  chmod +x .bin/wgcf
fi

cd .bin
[ -f wgcf-account.toml ] || { echo "» a registar conta Cloudflare WARP"; ./wgcf register --accept-tos; }
./wgcf generate
cd ..

{ cat .bin/wgcf-profile.conf; printf '\n[Socks5]\nBindAddress = 127.0.0.1:25344\n'; } > wireproxy.conf
chmod 600 wireproxy.conf
echo "» wireproxy.conf criado"
