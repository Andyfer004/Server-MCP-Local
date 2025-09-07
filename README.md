# Server MCP Local

Servidor MCP local con **Node.js + Express** que expone endpoints para:
- **FS**: leer y escribir archivos en directorios permitidos (`docs/`, `reports/`, `data/`).
- **SQLite**: ejecutar consultas de solo lectura.
- **LLM local**: generar texto y resúmenes usando `llama.cpp`.
- **Reportes**: construir reportes en Markdown y PDF.
- **Chat local**: sesiones de conversación persistentes.
- **Agente / Router**: interpretar mensajes libres y mapearlos a acciones (`read_file`, `write_file`, `summarize_file`, etc.).

---

## 📦 Requisitos

- Node.js v18+ (se probó con v23.11.0).
- TypeScript (`tsc`) para compilar.
- [llama.cpp](https://github.com/ggerganov/llama.cpp) instalado con Homebrew.
- Un modelo `.gguf` (ejemplo: `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` en carpeta `models/`).
- Dependencias instaladas con:

```bash
npm install
```

## ⚙️ Configuración

Variables de entorno (pueden ir en `.env`):

```
API_TOKEN=dev-token
MCP_ALLOWED_DIRS=docs,reports,data
DB_PATH=./data/app.db
LLAMA_MODEL=./models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
LLAMA_BIN=/opt/homebrew/opt/llama.cpp/bin/llama-cli
PORT=3001
```

## ▶️ Levantar servidor

1. Compilar TypeScript:

```bash
npm run build
```

2. Ejecutar:

```bash
API_TOKEN=dev-token \
MCP_ALLOWED_DIRS=docs,reports,data \
DB_PATH=./data/app.db \
LLAMA_MODEL=./models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
LLAMA_BIN=/opt/homebrew/opt/llama.cpp/bin/llama-cli \
PORT=3001 \
node dist/http.js
```

3. El servidor quedará en:

```
http://127.0.0.1:3001
```

## 🔍 Endpoints principales

### Health check

```bash
curl http://127.0.0.1:3001/health
```

### FS

```bash
# Escribir
curl -X POST http://127.0.0.1:3001/fs/write \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"path":"docs/demo.txt","content":"Hola Mundo"}'

# Leer
curl -X POST http://127.0.0.1:3001/fs/read \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"path":"docs/demo.txt"}'
```

### LLM

```bash
curl -X POST http://127.0.0.1:3001/llm/generate \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Dame 3 ventajas de un servidor MCP local"}'
```

### Reporte

```bash
curl -X POST http://127.0.0.1:3001/report/build \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"title":"Reporte de prueba","query":"demo","includeSummary":true}'
```

### Chat

```bash
# Crear sesión
curl -X POST http://127.0.0.1:3001/chat/session \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{}'

# Enviar mensaje
curl -X POST http://127.0.0.1:3001/chat/send \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<ID>","message":"Explica MCP local"}'
```