# Number Detail Search

A secure web application for searching phone number details.

## 🔐 Security

- **API Key Hidden**: External API key is stored on server (Edge Function), never exposed to browser
- **Environment Variables**: Supabase credentials stored in `.env` file (gitignored)
- **Authentication Required**: All API calls require valid user session
- **Server-side Validation**: User authentication verified on server before API calls

## 📦 Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create `.env` file (use `.env.example` as template):
```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials.

### 3. Create Admin User
1. Open Supabase Dashboard → Authentication → Users
2. Add new user with email/password
3. Run SQL to set admin role:
```sql
UPDATE nd_users SET role = 'admin' WHERE id = 'YOUR_USER_UUID';
```

### 4. Run Development Server
```bash
npm run dev
```

## 🛡️ Architecture

```
Browser (main.js)
    ↓ (Auth token only)
Edge Function (search-number)
    ↓ (API Key hidden here)
External API
```

The browser NEVER sees the external API key.

## 📁 Files

| File | Contains Secrets? |
|------|------------------|
| `.env` | Yes (gitignored) |
| `src/config.js` | No (reads from env) |
| `src/main.js` | No |
| Edge Function | Yes (server-only) |
