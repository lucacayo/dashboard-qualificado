#!/bin/bash
# deploy.sh — roda na sua máquina
# Requerimentos: Node.js instalado

echo "=============================="
echo "  Deploy Dashboard OC ADV"
echo "=============================="

# Instala Vercel CLI se não tiver
if ! command -v vercel &> /dev/null; then
  echo "→ Instalando Vercel CLI..."
  npm install -g vercel
fi

# Instala dependências
echo "→ Instalando dependências..."
npm install

# Deploy
echo "→ Fazendo deploy no Vercel..."
vercel --prod --yes

echo ""
echo "✓ Deploy concluído!"
echo "  Acesse a URL gerada acima."
