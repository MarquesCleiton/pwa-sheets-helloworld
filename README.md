# 📱 Vafyndell – PWA com Google Sheets & Auth

Aplicação **PWA (Progressive Web App)** construída com **Vite + TypeScript** que permite autenticação via **Google Identity Services (GIS)** e registro de dados em uma **planilha Google Sheets**.

---

## ✨ Funcionalidades

- Autenticação via Google (OAuth2)
- Registro de usuários em planilha do Google Sheets
- Suporte a instalação como app (PWA)
- Estrutura organizada seguindo Clean Architecture

---

## 🚀 Tecnologias

- [Vite](https://vitejs.dev/)
- TypeScript
- Google Identity Services
- Google Sheets API
- PWA com `vite-plugin-pwa`

---

## 🧱 Estrutura de Pastas

```
.
├── public/                     # Arquivos estáticos (index.html, manifest, pages)
│   └── pages/                 # Páginas HTML (ex: cadastro.html)
├── src/
│   ├── application/           # Casos de uso
│   ├── domain/                # Modelos de domínio
│   ├── infrastructure/
│   │   └── google/            # GoogleAuthManager.ts / SheetsClient.ts
│   ├── presentation/
│   │   ├── pages/             # Scripts específicos das páginas
│   │   └── components/        # Componentes visuais (futuros)
│   └── utils/                 # Funções auxiliares (ex: navegação)
├── vite.config.ts             # Configuração do Vite + PWA
└── tsconfig.json              # Configuração do TypeScript
```

---

## ⚙️ Requisitos

- Node.js (versão recomendada: 18+)
- Conta Google com permissão de acesso à planilha
- Autenticação habilitada no [Google Cloud Console](https://console.cloud.google.com/)

---

## 📦 Instalação

1. Clone o repositório:

```bash
git clone https://github.com/SEU_USUARIO/pwa-sheets-helloworld.git
cd pwa-sheets-helloworld
```

2. Instale as dependências:

```bash
npm install
```

---

## 💻 Rodando o projeto

### 🔧 Modo desenvolvimento (com hot reload)

```bash
npm run dev
```

> Por padrão em [`http://localhost:3000`](http://localhost:3000)

---

### 🧪 Modo produção (simular o build final)

```bash
npm run build
npm run preview
```

> Por padrão em [`http://localhost:4173`](http://localhost:4173)

---

### 🌐 Acesso por celular (rede local)

Para testar via IP local em outro dispositivo (ex: celular):

1. Descubra seu IP local:

```bash
ipconfig # (Windows)
ifconfig # (Linux/macOS)
```

2. Rode o servidor permitindo acesso externo:

```bash
npm run dev -- --host
```

Acesse via:

```
http://SEU_IP_LOCAL:3000
```

---

### (Opcional) Usar ngrok para HTTPS

```bash
npx ngrok http 3000
```

Acesse o link `https://xxxx.ngrok.io` no celular (HTTPS é obrigatório para instalação como PWA).

---

## 📤 Deploy no GitHub Pages

Este projeto está configurado para ser publicado no GitHub Pages com `base: "/pwa-sheets-helloworld/"`.

Para publicar:

```bash
npm run build
```

E publique a pasta `dist/` no GitHub Pages (por exemplo, usando a branch `gh-pages`).

---

## 📑 Licença

MIT License.