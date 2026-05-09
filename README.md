# Email Sender App

App para enviar emails masivos con adjuntos - ideal para captación de clientes.

## Installation

```bash
cd email-sender-app
npm install
```

## Configuration Gmail

1. Ve a tu cuenta Google → Seguridad
2. Activa la verificación en 2 pasos
3. Genera una **contraseña de aplicación** (App Password)
   - Busca "Contraseñas de aplicación" en tu cuenta
   - Crea una nueva para "Correo"
4. Usa esa contraseña en la app

## Usage

```bash
npm start
```

Abre http://localhost:3000

## Formatos aceptados

- **Excel**: Columna "email" o primer columna
- **TXT**: Un email por línea, separado por comas o punto y coma