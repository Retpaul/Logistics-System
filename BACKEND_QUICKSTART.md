A reusable blueprint extracted from the RegTech365 `server`. Copy this file into a new
backend repo and follow it top-to-bottom: you end up with a running Express + MongoDB +
TypeScript service with a complete **User model, JWT auth, email OTP, and TOTP
authenticator (Google Authenticator / Authy)** — and nothing else.

Everything unrelated to auth (queues, sockets, storage, AI, integrations) is deliberately
left out. Section 10 lists how to bolt those on later without breaking the layering.

---

## 1. Architecture at a glance

A **layered, class-per-domain** architecture. Each HTTP request flows in one direction:

```
HTTP request
   │
   ▼
routes/            thin. URL → middleware chain → controller method. No logic.
   │
   ▼
validations/       Joi schema, applied via validateReqBody(). Rejects with 400.
   │
   ▼
middleware/        authToken (JWT), twoFAChecker, isAdmin, file upload…
   │
   ▼
controllers/       one class per domain. Owns HTTP: reads req, shapes res.
   │                Never touches mongoose models directly.
   ▼
services/          (optional) cross-domain / multi-step business logic
   │
   ▼
repositories/      one class per domain. ALL database access lives here.
   │                Owns .populate() / .select() / .session() choices.
   ▼
models/            mongoose Schema + hooks (password hashing) + instance methods
   │
   ▼
MongoDB
```

Supporting folders:

| Folder | Purpose |
| --- | --- |
| `config/` | Every `process.env` read happens here, exported as typed consts. Nothing else calls `process.env`. |
| `interfaces/` | TypeScript interfaces (`IUser extends Document`) — the contract between model and repository. |
| `enums/` | Shared enums: status codes, response statuses, domain enums. |
| `utils/` | Stateless helpers: `statusCodes`, `twofaService`, mailer, crypto. |
| `exceptions/` | `ApiResponse` class hierarchy (`SuccessResponse`, `NotFoundErrorResponse`, …). |
| `startup/` | `db.ts` (Mongo connect), `routes.ts` (mount all routers + health), `logging.ts`. |
| `types/` | Ambient `.d.ts` — e.g. augmenting `Express.Request` with `user`. |

### Non-negotiable rules

1. **Controllers never import a model.** They go through a repository. This is what makes
   the whole thing portable — swap Mongo for Postgres and only `repositories/` + `models/` change.
2. **Every folder has an `index.ts` barrel** that instantiates the classes as singletons and
   re-exports them. Consumers write `import { usersRepository } from "../repositories"`.
3. **`config/envConfig.ts` is the only file that reads `process.env`.**
4. **The server listens before Mongo connects.** A DB outage must not kill the container.
   A readiness gate in `startup/routes.ts` returns a fast `503` on DB-dependent routes
   instead of letting requests hang on Mongoose's buffer.
5. **Routes are versioned** via `${version}` from env (`/api/v1`), applied in `startup/routes.ts`.

---

## 2. Folder structure to create

```
server/
├── src/
│   ├── app.ts
│   ├── config/
│   │   ├── envConfig.ts
│   │   └── index.ts
│   ├── controllers/
│   │   ├── authController.ts
│   │   └── index.ts
│   ├── enums/
│   │   └── index.ts
│   ├── exceptions/
│   │   ├── ApiResponse.ts
│   │   └── index.ts
│   ├── interfaces/
│   │   ├── user.ts
│   │   └── index.ts
│   ├── middleware/
│   │   ├── authToken.ts
│   │   ├── handlers.ts
│   │   ├── twoFAChecker.ts
│   │   └── index.ts
│   ├── models/
│   │   ├── users.ts
│   │   └── index.ts
│   ├── repositories/
│   │   ├── users.ts
│   │   └── index.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   └── index.ts
│   ├── startup/
│   │   ├── db.ts
│   │   └── routes.ts
│   ├── utils/
│   │   ├── statusCodes.ts
│   │   ├── twofaService.ts
│   │   ├── emails/
│   │   │   ├── emailLayout.ts
│   │   │   └── sendMail.ts
│   │   └── index.ts
│   └── validations/
│       ├── reqValidator.ts
│       ├── users.ts
│       └── index.ts
├── .env
├── .gitignore
├── Dockerfile
├── tsconfig.json
└── package.json
```

---

## 3. Quick start — install

```bash
mkdir server && cd server
npm init -y
```

### Runtime dependencies (auth + OTP + authenticator only)

```bash
npm i express express-async-errors cors cookie-parser compression morgan dotenv \
      mongoose soft-delete-plugin-mongoose \
      bcrypt jsonwebtoken joi \
      speakeasy qrcode nodemailer \
      chalk@4 winston
```

Why each one:

| Package | Role |
| --- | --- |
| `express` | HTTP framework |
| `express-async-errors` | Monkey-patches Express 4 so rejected promises in `async` handlers reach the error middleware instead of crashing the process. **Must be the first import in `app.ts`.** |
| `cors`, `cookie-parser`, `compression`, `morgan` | Standard middleware belt |
| `dotenv` | Loads `.env` |
| `mongoose` | ODM |
| `soft-delete-plugin-mongoose` | Adds `isDeleted`/`deletedAt` + `softDelete()` to schemas |
| `bcrypt` | Password hashing (pre-save hook + `comparePassword`) |
| `jsonwebtoken` | Access tokens, invite tokens, password-reset tokens |
| `joi` | Request-body validation schemas |
| **`speakeasy`** | **TOTP secret generation + code verification (authenticator app)** |
| **`qrcode`** | **Renders the `otpauth://` URL as a scannable data-URI QR code** |
| **`nodemailer`** | **Delivers the 6-digit email OTP + password-reset links** |
| `chalk@4` | Coloured boot logs. **Pin to v4** — v5+ is ESM-only and breaks CommonJS. |
| `winston` | Structured logging |

> `bcrypt` is a native module and needs build tools in the Docker image (see the Dockerfile).
> If you want a pure-JS build, swap `bcrypt` → `bcryptjs` and `@types/bcrypt` → `@types/bcryptjs`;
> the API is identical.

### Dev dependencies

```bash
npm i -D typescript ts-node nodemon concurrently rimraf copyfiles \
        @types/node @types/express @types/cors @types/cookie-parser \
        @types/compression @types/morgan @types/bcrypt @types/jsonwebtoken \
        @types/speakeasy @types/qrcode @types/nodemailer \
        jest ts-jest @types/jest supertest @types/supertest
```

### One-liner (both, copy-paste)

```bash
npm i express express-async-errors cors cookie-parser compression morgan dotenv mongoose soft-delete-plugin-mongoose bcrypt jsonwebtoken joi speakeasy qrcode nodemailer chalk@4 winston && npm i -D typescript ts-node nodemon concurrently rimraf copyfiles @types/node @types/express @types/cors @types/cookie-parser @types/compression @types/morgan @types/bcrypt @types/jsonwebtoken @types/speakeasy @types/qrcode @types/nodemailer jest ts-jest @types/jest supertest @types/supertest
```

### `package.json` scripts

```jsonc
{
  "main": "build/app.js",
  "scripts": {
    "build": "rimraf build && tsc",
    "prestart": "npm run build",
    "start": "node build/app.js",
    "dev": "concurrently \"npx tsc -w\" \"nodemon build/app.js\"",
    "test": "jest --verbose"
  }
}
```

### `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "es2016",
    "module": "commonjs",
    "rootDir": "./src",
    "outDir": "./build",
    "types": ["node", "jest"],
    "typeRoots": ["./src/types", "./node_modules/@types"],
    "resolveJsonModule": true,
    "noEmitOnError": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### `jest.config.js`

```js
module.exports = { preset: "ts-jest", testEnvironment: "node" };
```

### `.env`

```ini
PORT=8001
environment=development
version=/api/v1

MONGODB_URI=mongodb://127.0.0.1:27017/myapp

JWT_SECRET=replace-with-a-long-random-string
CLIENT_URL=http://localhost:3000

# Mail (email OTP + password reset)
SERVICE=smtp.gmail.com
MAIL_FROM=no-reply@example.com
PASSMAILER=your-smtp-app-password

# TOTP issuer name shown in the authenticator app
TOTP_ISSUER=MyApp

# Optional Mongo pool tuning
DB_MIN_POOL_SIZE=2
DB_MAX_POOL_SIZE=10
```

### `.gitignore`

```
node_modules
build
.env
*.log
coverage
```

### `Dockerfile`

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache make g++ python3      # needed by bcrypt
ENV NODE_OPTIONS="--max-old-space-size=3072"
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8001
CMD ["npm", "start"]
```

---

## 4. Foundation files

### `src/config/envConfig.ts`

```ts
import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 8001;
export const version = process.env.version || "/api/v1";
export const environment = process.env.environment || "development";

export const MONGODB_URI = process.env.MONGODB_URI;
export const JWT_SECRET = process.env.JWT_SECRET;
export const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

export const SERVICE = process.env.SERVICE;
export const MAIL_FROM = process.env.MAIL_FROM;
export const PASSMAILER = process.env.PASSMAILER;
export const TOTP_ISSUER = process.env.TOTP_ISSUER || "MyApp";

// Fail fast at boot rather than at first login.
if (!JWT_SECRET) throw new Error("JWT_SECRET is not set");
if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
```

`src/config/index.ts`:

```ts
export * from "./envConfig";
```

### `src/utils/statusCodes.ts`

```ts
const StatusCodes = {
  OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429, SERVER_ERROR: 500, SERVICE_UNAVAILABLE: 503,
};
export default StatusCodes;
```

`src/utils/index.ts`:

```ts
export { default as StatusCodes } from "./statusCodes";
export * from "./twofaService";
```

### `src/enums/index.ts`

```ts
/** Machine-readable code the client switches on, independent of HTTP status. */
export enum StatusCode {
  OK = "10000",
  CREATED = "10001",
  NO_CONTENT = "10002",
  FAILURE = "10003",
  RETRY = "10004",
  INVALID_ACCESS_TOKEN = "10005",
}

export enum ResponseStatus {
  OK = 200, CREATED = 201, NO_CONTENT = 204,
  BAD_REQUEST = 400, UN_AUTHORISED = 401, FORBIDDEN = 403,
  NOT_FOUND = 404, CONFLICT = 409, UNPROCESSABLE_ENTITY = 422,
  INTERNAL_ERROR = 500,
}

export enum TwoFAMethod {
  EMAIL = "email",
  TOTP = "totp",
}
```

### `src/exceptions/ApiResponse.ts` (abridged — add classes as needed)

```ts
import { Response } from "express";
import { StatusCode, ResponseStatus } from "../enums";

export abstract class ApiResponse {
  constructor(
    protected statusCode: StatusCode,
    protected status: ResponseStatus,
    protected message: string,
    protected data: any = {},
  ) {}

  protected prepare<T extends ApiResponse>(
    res: Response, response: T, headers: Record<string, string>,
  ): Response {
    for (const [k, v] of Object.entries(headers)) res.append(k, v);
    return res.status(this.status).json(ApiResponse.sanitize(response));
  }

  public send(res: Response, headers: Record<string, string> = {}): Response {
    return this.prepare<ApiResponse>(res, this, headers);
  }

  private static sanitize<T extends ApiResponse>(response: T): T {
    const clone = { ...response } as T;
    // @ts-ignore — `status` is the HTTP code, already on the response line
    delete clone.status;
    for (const i in clone) if (typeof clone[i] === "undefined") delete clone[i];
    return clone;
  }
}

export class SuccessResponse<T> extends ApiResponse {
  constructor(message: string, data: T | null = null) {
    super(StatusCode.OK, ResponseStatus.OK, message, data);
  }
}
export class CreateSuccessResponse<T> extends ApiResponse {
  constructor(message: string, data: T) {
    super(StatusCode.CREATED, ResponseStatus.CREATED, message, data);
  }
}
export class BadRequestErrorResponse<T> extends ApiResponse {
  constructor(message = "Bad Parameters", data?: T) {
    super(StatusCode.FAILURE, ResponseStatus.BAD_REQUEST, message, data);
  }
}
export class AuthFailureResponse extends ApiResponse {
  constructor(message = "Authentication Failure") {
    super(StatusCode.FAILURE, ResponseStatus.UN_AUTHORISED, message);
  }
}
export class NotFoundErrorResponse extends ApiResponse {
  constructor(message = "Not Found") {
    super(StatusCode.FAILURE, ResponseStatus.NOT_FOUND, message);
  }
}
export class InternalServerErrorResponse extends ApiResponse {
  constructor(message = "Internal Error") {
    super(StatusCode.FAILURE, ResponseStatus.INTERNAL_ERROR, message);
  }
}
```

`src/exceptions/index.ts`:

```ts
export * from "./ApiResponse";
```

### `src/types/express.d.ts` — so `req.user` is typed

```ts
declare namespace Express {
  interface Request {
    user?: {
      _id: string;
      email: string;
      firstName?: string;
      lastName?: string;
      role?: string;
    };
  }
}
```

---

## 5. The User model — the reference example

This is the pattern every other domain copies: **interface → schema → repository**.

### `src/interfaces/user.ts`

```ts
import mongoose, { Document } from "mongoose";

export interface IUser extends Document {
  // BASIC INFORMATION
  avatar?: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;

  role?: mongoose.Types.ObjectId | any;

  // TWO-FACTOR AUTH
  twoFA: {
    /** Which method is used when 2FA is challenged. */
    default: "email" | "totp";
    /** Confirmed TOTP secret (base32). Only set after a successful verify. */
    secret?: string;
    /** Pending TOTP secret, held between /setup and /verify. */
    tempSecret?: string;
    totp: { isEnabled: boolean; isVerified: boolean };
    email: { isEnabled: boolean; isVerified: boolean };
  };

  // EMAIL OTP
  otpCode?: string | null;
  otpExpires?: Date | null;

  // PASSWORD RESET
  resetPasswordToken?: string | null;
  resetPasswordExpires?: Date | null;

  // LIFECYCLE
  status?: "pending" | "active";
  lastActive?: Date;
  lastVerified?: Date | null;
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt?: Date;

  // METHODS
  comparePassword(password: string): Promise<boolean>;
}
```

`src/interfaces/index.ts`:

```ts
export * from "./user";
```

### `src/models/users.ts`

```ts
import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import { SoftDeleteModel, softDeletePlugin } from "soft-delete-plugin-mongoose";
import { IUser } from "../interfaces";

const userSchema = new Schema<IUser>(
  {
    avatar: { type: String, default: "" },

    email: {
      type: String,
      required: true,
      lowercase: true,
      unique: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },

    // Optional: invited users are created without one and set it via the invite link.
    password: { type: String, required: false, select: false },

    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String },

    role: { type: mongoose.Schema.Types.ObjectId, ref: "Roles" },

    // ---- 2FA ----
    twoFA: {
      default: { type: String, enum: ["email", "totp"], default: "email" },
      secret: { type: String, select: false },
      tempSecret: { type: String, select: false },
      totp: {
        isEnabled: { type: Boolean, default: false },
        isVerified: { type: Boolean, default: false },
      },
      email: {
        isEnabled: { type: Boolean, default: true },
        isVerified: { type: Boolean, default: false },
      },
    },

    // ---- Email OTP ----
    otpCode: { type: String, default: null, select: false },
    otpExpires: { type: Date, default: null },

    // ---- Password reset ----
    resetPasswordToken: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null },

    // ---- Lifecycle ----
    status: { type: String, enum: ["pending", "active"], default: "pending" },
    lastActive: { type: Date },
    lastVerified: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Query-performance indexes — add one per hot filter combination.
userSchema.index({ status: 1, isDeleted: 1 });
userSchema.index({ role: 1, isDeleted: 1 });

/** Hash on save. Guarded by isModified so re-saves don't double-hash. */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password as string, salt);
  next();
});

userSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
  return bcrypt.compare(password, this.password);
};

userSchema.plugin(softDeletePlugin);

export const Users = mongoose.model<IUser, SoftDeleteModel<IUser>>("Users", userSchema);
```

> **Note on `select: false`:** `password`, `twoFA.secret`, `twoFA.tempSecret`, `otpCode`
> and `resetPasswordToken` are excluded from queries by default so they can never leak
> through a `findOne()` that gets JSON-serialized. Repository methods that genuinely need
> them opt back in with `.select("+password")`.
>
> ⚠️ A `pre("save")` hook does **not** run on `findOneAndUpdate` / `updateOne`. If you ever
> set a password through an update query, hash it yourself first.

`src/models/index.ts`:

```ts
export * from "./users";
```

### `src/repositories/users.ts`

Notice the deliberately *narrow* finders. Login paths select only what the JWT and the
session response need; they never pull the whole document.

```ts
import { SoftDeleteModel } from "soft-delete-plugin-mongoose";
import { IUser } from "../interfaces";
import { Users } from "../models";

class UsersRepository {
  private UsersModel: SoftDeleteModel<IUser>;

  constructor() {
    this.UsersModel = Users;
  }

  /** Generic single-user lookup with the common populates. */
  public async findOneUser(filters: object) {
    return this.UsersModel.findOne(filters).populate("role", "name").exec();
  }

  /** Login path: the ONLY place that pulls the password hash. */
  public async findUserOnLogin(filters: object) {
    return this.UsersModel.findOne(filters).select("+password").exec();
  }

  /** 2FA path: needs the secrets, nothing else. */
  public async findUserFor2FA(filters: object) {
    return this.UsersModel.findOne(filters)
      .select("+twoFA.secret +twoFA.tempSecret +otpCode _id email firstName twoFA otpExpires lastVerified")
      .exec();
  }

  /** Shape sent back to the client after a successful login. */
  public async findUserForSession(filters: object) {
    return this.UsersModel.findOne(filters)
      .select("_id email firstName lastName phone avatar role status twoFA")
      .populate("role", "name")
      .exec();
  }

  public async findAllUsers(filters: object) {
    return this.UsersModel.find(filters).sort({ createdAt: -1 }).populate("role").exec();
  }

  public async createUser(data: object, session?: any) {
    const user = new this.UsersModel(data);
    return user.save({ session });
  }

  public async findOneAndUpdate(filters: object, data: object, options = {}) {
    return this.UsersModel.findOneAndUpdate(filters, data, { new: true, ...options }).exec();
  }

  /** Dotted-path 2FA writes: `{ "twoFA.secret": "…", "twoFA.totp.isEnabled": true }` */
  public async update2FA(userId: string, update: Record<string, any>) {
    return this.UsersModel.findByIdAndUpdate(userId, { $set: update }, { new: true }).exec();
  }

  public async updateLastActive(userId: string, lastActive: Date) {
    return this.UsersModel.findByIdAndUpdate(userId, { $set: { lastActive } }, { new: true }).exec();
  }

  public async countUsers(filters: object) {
    return this.UsersModel.countDocuments(filters);
  }
}

export default UsersRepository;
```

`src/repositories/index.ts` — the barrel that makes singletons:

```ts
import UsersRepository from "./users";

const usersRepository = new UsersRepository();

export { usersRepository };
```

---

## 6. Auth: JWT, email OTP, and TOTP authenticator

### `src/utils/twofaService.ts` — the whole 2FA primitive layer

```ts
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { TOTP_ISSUER } from "../config";

export const TwoFAService = {
  /** Creates a new TOTP secret. `otpauth_url` is what the QR code encodes. */
  generateTOTPSecret(email: string) {
    return speakeasy.generateSecret({ name: `${TOTP_ISSUER} (${email})` });
  },

  /** Renders the otpauth:// URL as a data-URI PNG the client can <img src=…>. */
  async generateQRCode(otpauthUrl: string) {
    return qrcode.toDataURL(otpauthUrl);
  },

  /** window:1 tolerates one 30s step of clock drift either side. */
  verifyTOTP(token: string, secret: string) {
    return speakeasy.totp.verify({ secret, encoding: "base32", token, window: 1 });
  },

  /** 6-digit numeric code for the email fallback channel. */
  generateEmailCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },
};
```

### `src/utils/emails/sendMail.ts` — minimal mailer

```ts
import nodemailer from "nodemailer";
import { SERVICE, MAIL_FROM, PASSMAILER, CLIENT_URL, TOTP_ISSUER } from "../../config";
import { getEmailTemplate } from "./emailLayout";

/** Tries implicit TLS (465) then STARTTLS (587); returns the first that verifies. */
export const createMailTransporter = async () => {
  const configs = [
    { host: SERVICE, port: 465, secure: true },
    { host: SERVICE, port: 587, secure: false },
  ];

  for (const base of configs) {
    try {
      const transporter = nodemailer.createTransport({
        ...base,
        tls: { rejectUnauthorized: false },
        auth: { user: MAIL_FROM, pass: PASSMAILER },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
      });
      await transporter.verify();
      return transporter;
    } catch {
      /* try the next port */
    }
  }
  throw new Error("Unable to establish an SMTP connection");
};

export const send2FACodeMail = async (firstName: string, email: string, code: string) => {
  const transporter = await createMailTransporter();
  const body = `
    <p>Hi ${firstName || "there"},</p>
    <p>Your verification code is:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
    <p>It expires in 5 minutes. If you didn't request it, ignore this email.</p>`;
  await transporter.sendMail({
    from: `"${TOTP_ISSUER}" <${MAIL_FROM}>`,
    to: email,
    subject: "Your verification code",
    html: getEmailTemplate("Verification code", body),
  });
};

export const sendPasswordResetMail = async (firstName: string, email: string, url: string) => {
  const transporter = await createMailTransporter();
  const body = `
    <p>Hi ${firstName || "there"},</p>
    <p>Click below to reset your password. The link expires in 1 hour.</p>
    <p><a href="${url}">Reset my password</a></p>`;
  await transporter.sendMail({
    from: `"${TOTP_ISSUER}" <${MAIL_FROM}>`,
    to: email,
    subject: "Reset your password",
    html: getEmailTemplate("Reset your password", body),
  });
};

export const sendInviteMail = async (firstName: string, email: string, token: string) => {
  const transporter = await createMailTransporter();
  const actionUrl = `${CLIENT_URL}/create-password?token=${token}`;
  const body = `
    <p>Hi ${firstName || "there"},</p>
    <p>You've been invited. Set your password to activate your account:</p>
    <p><a href="${actionUrl}">Activate my account</a></p>`;
  await transporter.sendMail({
    from: `"${TOTP_ISSUER}" <${MAIL_FROM}>`,
    to: email,
    subject: "You've been invited",
    html: getEmailTemplate("Activate your account", body),
  });
};
```

`src/utils/emails/emailLayout.ts`:

```ts
export const getEmailTemplate = (title: string, bodyContent: string): string => `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f5f6fa">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 12px">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#fff;border-radius:8px;padding:32px;text-align:left">
          ${bodyContent}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
```

### `src/middleware/authToken.ts`

```ts
import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import StatusCodes from "../utils/statusCodes";

interface DecodedToken {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

/** Rejects the request when there's no valid Bearer token. */
export const authToken = (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.headers.authorization?.startsWith("Bearer")) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }
    const token = req.headers.authorization.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET as string) as DecodedToken;
    return next();
  } catch {
    return res.status(StatusCodes.UNAUTHORIZED).json({
      success: false,
      message: "Session ended. Please log in again.",
    });
  }
};

/** Attaches req.user when a token is present, but never blocks. */
export const optionalAuthToken = (req: any, _res: Response, next: NextFunction) => {
  try {
    if (req.headers.authorization?.startsWith("Bearer")) {
      const token = req.headers.authorization.split(" ")[1];
      req.user = jwt.verify(token, JWT_SECRET as string) as DecodedToken;
    }
  } catch {
    /* fall through unauthenticated */
  }
  return next();
};

/** The full-access token, issued only after 2FA passes. */
export const signInToken = async (user: any): Promise<string> =>
  jwt.sign(
    {
      _id: user?._id,
      email: user?.email,
      firstName: user?.firstName,
      lastName: user?.lastName,
      role: user?.role?._id ?? user?.role,
    },
    JWT_SECRET as string,
    { expiresIn: "12h" },
  );

/**
 * Short-lived token proving "password was correct" but NOT "2FA passed".
 * The client sends it back to /auth/2fa/verify. Keeping the two token types
 * distinct is what stops a half-authenticated client from calling real routes.
 */
export const preAuthToken = (user: any): string =>
  jwt.sign({ _id: user._id, email: user.email, type: "pre_auth" }, JWT_SECRET as string, {
    expiresIn: "10m",
  });
```

### `src/middleware/twoFAChecker.ts`

Routes the challenge to TOTP when the authenticator is enabled, otherwise to email OTP.

```ts
import { Request, Response, NextFunction } from "express";
import StatusCodes from "../utils/statusCodes";
import { TwoFAService } from "../utils/twofaService";
import { usersRepository } from "../repositories";
import { signInToken } from "./authToken";

export const twoFAChecker = async (req: Request, res: Response, next: NextFunction) => {
  const { token, email } = req.body;

  const user = await usersRepository.findUserFor2FA({ email: String(email).toLowerCase() });
  if (!user?.email) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Invalid user." });
  }

  const totpActive = user.twoFA?.totp?.isEnabled && user.twoFA?.totp?.isVerified;
  return totpActive
    ? handleTOTP2FA(user, token, res, next)
    : handleEmail2FA(user, token, res, next);
};

/** Email OTP — the default for users who haven't set up an authenticator. */
const handleEmail2FA = async (user: any, code: string, res: Response, _next: NextFunction) => {
  const now = new Date();
  const normalize = (v: any) => String(v).trim();
  const isValid =
    code &&
    user.otpCode &&
    normalize(code) === normalize(user.otpCode) &&
    user.otpExpires &&
    now <= new Date(user.otpExpires);

  if (!isValid) {
    return res
      .status(StatusCodes.BAD_REQUEST)
      .json({ success: false, message: "Invalid or expired OTP code." });
  }

  // Burn the code so it can't be replayed.
  await usersRepository.update2FA(user._id, {
    otpCode: null,
    otpExpires: null,
    lastVerified: now,
  });

  return res.status(StatusCodes.OK).json({
    success: true,
    message: "OTP verified.",
    data: { token: await signInToken(user), lastVerified: now },
  });
};

/** TOTP — authenticator app codes. */
const handleTOTP2FA = async (user: any, token: string, res: Response, _next: NextFunction) => {
  const now = new Date();
  const secret = user.twoFA?.secret;
  const isValid = secret && token && TwoFAService.verifyTOTP(token, secret);

  if (!isValid) {
    return res
      .status(StatusCodes.UNAUTHORIZED)
      .json({ success: false, message: "Invalid TOTP code." });
  }

  await usersRepository.update2FA(user._id, { lastVerified: now });

  return res.status(StatusCodes.OK).json({
    success: true,
    message: "TOTP verified.",
    data: { token: await signInToken(user), lastVerified: now },
  });
};
```

### `src/middleware/handlers.ts`

```ts
import { Request, Response, NextFunction } from "express";

export const logRequest = (req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
};

export const pageNotFound = () => (req: Request, res: Response) =>
  res.status(404).json({ status: "error", message: `Not Found: ${req.originalUrl}` });

/** Terminal error middleware — must be registered LAST, and must take 4 args. */
export const errorHandler = (
  err: Error & { type?: string; status?: number },
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) return next(err);

  if (err.type === "entity.too.large") {
    return res.status(413).json({ status: "error", message: "Request payload is too large." });
  }

  console.error("[Global Error Handler]", err);
  return res.status(err.status || 500).json({ status: "error", message: "Internal Server Error" });
};

/** Wrapper for pre-express-async-errors code paths; usually unnecessary. */
export const asyncHandler =
  (handler: Function) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
```

`src/middleware/index.ts`:

```ts
export * from "./authToken";
export * from "./handlers";
export * from "./twoFAChecker";
```

### `src/validations/reqValidator.ts`

```ts
import { NextFunction, Request, Response } from "express";
import Joi from "joi";

export class ReqValidator {
  public validateReqBody =
    (schema: Joi.ObjectSchema<any>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        req.body = await schema.validateAsync(req.body, {
          abortEarly: false,
          allowUnknown: true,
          stripUnknown: true,
        });
        next();
      } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
      }
    };

  public validateReqQuery =
    (schema: Joi.ObjectSchema<any>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        req.query = await schema.validateAsync(req.query, {
          abortEarly: false,
          allowUnknown: true,
          stripUnknown: true,
        });
        next();
      } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
      }
    };
}
```

### `src/validations/users.ts`

```ts
import Joi from "joi";

export class UsersReqSchema {
  public RegisterReq() {
    return Joi.object({
      firstName: Joi.string().min(1).max(100).required(),
      lastName: Joi.string().min(1).max(100).required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).required().messages({
        "string.min": "password must be at least 8 characters",
      }),
      phone: Joi.string().optional(),
    });
  }

  /** Accepts either a password (step 1) or a 2FA token (step 2). */
  public LoginReq() {
    return Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().optional(),
      token: Joi.string().optional(),
    }).or("password", "token");
  }

  public OtpReq() {
    return Joi.object({ email: Joi.string().email().required() });
  }

  public TwoFAVerifyReq() {
    return Joi.object({
      email: Joi.string().email().required(),
      token: Joi.string().required(),
    });
  }

  public ForgotPasswordReq() {
    return Joi.object({ email: Joi.string().email().required() });
  }

  public ResetPasswordReq() {
    return Joi.object({
      token: Joi.string().required(),
      password: Joi.string().min(8).required(),
    });
  }
}
```

`src/validations/index.ts`:

```ts
import { ReqValidator } from "./reqValidator";
import { UsersReqSchema } from "./users";

const { validateReqBody, validateReqQuery } = new ReqValidator();
const {
  RegisterReq, LoginReq, OtpReq, TwoFAVerifyReq,
  ForgotPasswordReq, ResetPasswordReq,
} = new UsersReqSchema();

export {
  validateReqBody, validateReqQuery,
  RegisterReq, LoginReq, OtpReq, TwoFAVerifyReq,
  ForgotPasswordReq, ResetPasswordReq,
};
```

### `src/controllers/authController.ts`

```ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import StatusCodes from "../utils/statusCodes";
import { JWT_SECRET, CLIENT_URL } from "../config";
import { usersRepository } from "../repositories";
import { TwoFAService } from "../utils/twofaService";
import { signInToken, preAuthToken } from "../middleware/authToken";
import { send2FACodeMail, sendPasswordResetMail } from "../utils/emails/sendMail";

class AuthController {
  /** POST /auth/register */
  public register = async (req: Request, res: Response) => {
    const { email, password, firstName, lastName, phone } = req.body;
    const lowerEmail = String(email).toLowerCase();

    if (await usersRepository.findOneUser({ email: lowerEmail })) {
      return res
        .status(StatusCodes.CONFLICT)
        .json({ success: false, message: "An account with this email already exists." });
    }

    // The pre-save hook hashes `password`.
    const user = await usersRepository.createUser({
      email: lowerEmail, password, firstName, lastName, phone, status: "active",
    });

    const data = user.toObject();
    delete (data as any).password;

    return res
      .status(StatusCodes.CREATED)
      .json({ success: true, message: "Account created.", data });
  };

  /**
   * POST /auth/login — step 1.
   * Verifies the password, then hands back a 10-minute pre-auth token and tells
   * the client which 2FA challenge to present. No full token is issued here.
   */
  public login = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const lowerEmail = String(email).toLowerCase();

      const user = await usersRepository.findUserOnLogin({ email: lowerEmail });
      // Same message for "no user" and "wrong password" — don't leak which emails exist.
      if (!user?.password || !(await bcrypt.compare(password, user.password))) {
        return res
          .status(StatusCodes.UNAUTHORIZED)
          .json({ success: false, message: "Invalid credentials." });
      }

      const totpActive = user.twoFA?.totp?.isEnabled && user.twoFA?.totp?.isVerified;

      // Email is the fallback channel: send the code now so the client can prompt.
      if (!totpActive) await this.issueEmailOtp(user);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Credentials verified. Complete two-factor authentication.",
        data: {
          twoFactorRequired: true,
          method: totpActive ? "totp" : "email",
          preAuthToken: preAuthToken(user),
          email: user.email,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      return res
        .status(StatusCodes.SERVER_ERROR)
        .json({ success: false, message: "An error occurred during login." });
    }
  };

  /** POST /auth/otp — (re)send the 6-digit email code. */
  public sendEmailOTP = async (req: Request, res: Response) => {
    try {
      const lowerEmail = String(req.body.email).toLowerCase();
      const user = await usersRepository.findOneUser({ email: lowerEmail });

      // Always answer 200: a 404 here is an account-enumeration oracle.
      if (user) await this.issueEmailOtp(user);

      return res
        .status(StatusCodes.OK)
        .json({ success: true, message: "If the account exists, a code has been sent." });
    } catch (error) {
      console.error("Error sending OTP:", error);
      return res
        .status(StatusCodes.SERVER_ERROR)
        .json({ success: false, message: "Failed to send OTP code." });
    }
  };

  /** Generates + stores a code, then mails it without blocking the response. */
  private issueEmailOtp = async (user: any) => {
    const code = TwoFAService.generateEmailCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await usersRepository.update2FA(user._id, { otpCode: code, otpExpires: expiresAt });

    void send2FACodeMail(user.firstName, user.email, code).catch((err) =>
      console.error("Failed to send OTP email:", err),
    );
  };

  /**
   * POST /auth/2fa/totp/setup — authenticated.
   * Stores a PENDING secret and returns the QR code. The secret only becomes
   * live once /verify proves the user can generate a valid code from it.
   */
  public setupTOTP = async (req: any, res: Response) => {
    try {
      const user = await usersRepository.findOneUser({ _id: req.user._id });
      if (!user?.email) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ success: false, message: "Invalid user." });
      }

      const { base32, otpauth_url } = TwoFAService.generateTOTPSecret(user.email);
      const qrcode = await TwoFAService.generateQRCode(otpauth_url!);

      await usersRepository.update2FA(user._id, {
        "twoFA.tempSecret": base32,
        "twoFA.totp.isEnabled": false,
        "twoFA.totp.isVerified": false,
      });

      // base32 is returned so the user can type it in manually if the QR won't scan.
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "TOTP setup initiated. Scan the QR code, then verify.",
        data: { qrcode, base32 },
      });
    } catch (error) {
      console.error("setupTOTP error:", error);
      return res
        .status(StatusCodes.SERVER_ERROR)
        .json({ success: false, message: "TOTP setup failed." });
    }
  };

  /** POST /auth/2fa/totp/verify — authenticated. Promotes tempSecret → secret. */
  public verifyTOTP = async (req: any, res: Response) => {
    try {
      const { token } = req.body;
      const user = await usersRepository.findUserFor2FA({ _id: req.user._id });
      if (!user) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ success: false, message: "User not found." });
      }

      const twoFA = user.twoFA;

      if (twoFA?.totp?.isEnabled && twoFA?.totp?.isVerified) {
        return res
          .status(StatusCodes.OK)
          .json({ success: true, message: "TOTP is already enabled." });
      }
      if (!twoFA?.tempSecret) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ success: false, message: "TOTP not initialised. Call /setup first." });
      }
      if (!TwoFAService.verifyTOTP(token, twoFA.tempSecret)) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ success: false, message: "Invalid TOTP token." });
      }

      await usersRepository.update2FA(user._id, {
        "twoFA.secret": twoFA.tempSecret,
        "twoFA.tempSecret": null,
        "twoFA.totp.isEnabled": true,
        "twoFA.totp.isVerified": true,
        "twoFA.default": "totp",
      });

      return res
        .status(StatusCodes.OK)
        .json({ success: true, message: "TOTP two-factor authentication enabled." });
    } catch (error) {
      console.error("verifyTOTP error:", error);
      return res
        .status(StatusCodes.SERVER_ERROR)
        .json({ success: false, message: "Could not enable TOTP." });
    }
  };

  /** POST /auth/2fa/totp/disable — authenticated. Requires a current code. */
  public disableTOTP = async (req: any, res: Response) => {
    const { token } = req.body;
    const user = await usersRepository.findUserFor2FA({ _id: req.user._id });

    if (!user?.twoFA?.secret || !TwoFAService.verifyTOTP(token, user.twoFA.secret)) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ success: false, message: "Invalid TOTP token." });
    }

    await usersRepository.update2FA(user._id, {
      "twoFA.secret": null,
      "twoFA.tempSecret": null,
      "twoFA.totp.isEnabled": false,
      "twoFA.totp.isVerified": false,
      "twoFA.default": "email",
    });

    return res
      .status(StatusCodes.OK)
      .json({ success: true, message: "TOTP disabled. Email OTP is now the 2FA method." });
  };

  /** POST /auth/forgot-password */
  public forgotPassword = async (req: Request, res: Response) => {
    const lowerEmail = String(req.body.email).toLowerCase();
    const user = await usersRepository.findOneUser({ email: lowerEmail });

    if (user) {
      const resetToken = jwt.sign(
        { _id: user._id, email: user.email, type: "password_reset" },
        JWT_SECRET as string,
        { expiresIn: "1h" },
      );

      await usersRepository.findOneAndUpdate(
        { _id: user._id },
        { resetPasswordToken: resetToken, resetPasswordExpires: new Date(Date.now() + 3600_000) },
      );

      const resetUrl = `${CLIENT_URL}/reset-password/${resetToken}`;
      void sendPasswordResetMail(user.firstName || "", user.email, resetUrl).catch((err) =>
        console.error("Failed to send reset email:", err),
      );
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "If the account exists, a reset link has been sent.",
    });
  };

  /** POST /auth/reset-password */
  public resetPassword = async (req: Request, res: Response) => {
    const { password, token } = req.body;
    try {
      const decoded = jwt.verify(token, JWT_SECRET as string) as any;

      const user = await usersRepository.findOneUser({
        _id: decoded._id,
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() },
      });
      if (!user) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ success: false, message: "Invalid or expired reset token." });
      }

      // Assign + save (not findOneAndUpdate) so the pre-save hash hook runs.
      user.password = password;
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();

      return res
        .status(StatusCodes.OK)
        .json({ success: true, message: "Password reset successful." });
    } catch {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ success: false, message: "Invalid or expired reset token." });
    }
  };

  /** GET /auth/me — authenticated. */
  public me = async (req: any, res: Response) => {
    const user = await usersRepository.findUserForSession({ _id: req.user._id });
    if (!user) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ success: false, message: "User not found." });
    }
    await usersRepository.updateLastActive(user._id, new Date());
    return res.status(StatusCodes.OK).json({ success: true, data: user });
  };
}

export default AuthController;
```

`src/controllers/index.ts`:

```ts
import AuthController from "./authController";

const authController = new AuthController();

export { authController };
```

### `src/routes/auth.ts`

```ts
import express from "express";
import { authController } from "../controllers";
import { authToken, twoFAChecker } from "../middleware";
import {
  validateReqBody, RegisterReq, LoginReq, OtpReq,
  TwoFAVerifyReq, ForgotPasswordReq, ResetPasswordReq,
} from "../validations";

const router = express.Router();

// --- Public ---
router.post("/register", validateReqBody(RegisterReq()), authController.register);
router.post("/login", validateReqBody(LoginReq()), authController.login);

// 2FA challenge: routes to TOTP or email OTP and issues the full token on success.
router.post("/2fa/verify", validateReqBody(TwoFAVerifyReq()), twoFAChecker);
router.post("/otp", validateReqBody(OtpReq()), authController.sendEmailOTP);

router.post("/forgot-password", validateReqBody(ForgotPasswordReq()), authController.forgotPassword);
router.post("/reset-password", validateReqBody(ResetPasswordReq()), authController.resetPassword);

// --- Authenticated ---
router.get("/me", authToken, authController.me);
router.post("/2fa/totp/setup", authToken, authController.setupTOTP);
router.post("/2fa/totp/verify", authToken, authController.verifyTOTP);
router.post("/2fa/totp/disable", authToken, authController.disableTOTP);

export default router;
```

`src/routes/index.ts`:

```ts
import authRouter from "./auth";

export { authRouter };
```

---

## 7. Wiring it together

### `src/startup/db.ts`

```ts
import { connect, ConnectOptions, set } from "mongoose";
import chalk from "chalk";
import { MONGODB_URI } from "../config";

set("strictQuery", false);

const envNumber = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const DB_OPTIONS: ConnectOptions = {
  autoIndex: true,
  minPoolSize: envNumber("DB_MIN_POOL_SIZE", 2),
  maxPoolSize: envNumber("DB_MAX_POOL_SIZE", 10),
  serverSelectionTimeoutMS: envNumber("DB_SERVER_SELECTION_TIMEOUT_MS", 15000),
  connectTimeoutMS: envNumber("DB_CONNECT_TIMEOUT_MS", 30000),
  socketTimeoutMS: envNumber("DB_SOCKET_TIMEOUT_MS", 45000),
};

export = async (DB: string = MONGODB_URI!, options: ConnectOptions = DB_OPTIONS) => {
  const mongo = await connect(DB, options);
  console.log(`${chalk.italic.yellow("DB Connection")}: ${chalk.bold.green("Successful")}`);
  return mongo.connection.getClient();
};
```

### `src/startup/routes.ts`

```ts
import express, { Request, Response, Application, NextFunction } from "express";
import { connection } from "mongoose";
import { authRouter } from "../routes";
import { pageNotFound, errorHandler, logRequest } from "../middleware";
import { version } from "../config";

export = function (app: Application) {
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(logRequest);

  /**
   * Readiness gate. The server listens before Mongo connects (see app.ts), so
   * short-circuit DB-dependent routes with an explicit 503 rather than letting
   * requests hang on Mongoose's operation buffer. Liveness and the health probe
   * stay open so orchestrator probes always get a real answer.
   */
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (connection.readyState === 1) return next();
    if (req.path === "/" || req.path === `${version}/health`) return next();
    return res.status(503).json({
      status: false,
      message: "Database unavailable, starting up. Please retry shortly.",
    });
  });

  app.use(`${version}/auth`, authRouter);

  app.get(`${version}/health`, (_req: Request, res: Response) => {
    const states: Record<number, string> = {
      0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting",
    };
    const ready = connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
      status: ready,
      db: states[connection.readyState] || "unknown",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (_req: Request, res: Response) =>
    res.json({ status: true, message: "service health check passed ✅" }),
  );

  app.use("*", pageNotFound());
  app.use(errorHandler); // must be last
};
```

### `src/app.ts`

```ts
// Must be the first import: monkey-patches Express 4 so rejected promises from
// async handlers reach the error middleware instead of killing the process.
import "express-async-errors";
import express, { Application } from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import morgan from "morgan";
import winston from "winston";
import chalk from "chalk";
import { PORT, environment, CLIENT_URL } from "./config";
import routes from "./startup/routes";
import db from "./startup/db";

const allowedOrigins = [CLIENT_URL, "http://localhost:3000", "http://localhost:5173"];

const app: Application = express();

winston.add(new winston.transports.Console());
app.use(morgan("dev"));
app.use(
  cors({
    // No origin = server-to-server / curl / mobile — allow it.
    origin: (origin, cb) =>
      !origin || allowedOrigins.includes(origin)
        ? cb(null, true)
        : cb(new Error("Not allowed by CORS")),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.set("trust proxy", 1); // ingress terminates TLS
app.use(cookieParser());
app.use(compression({}));

// Log only — never exit. One stray rejection must not take everyone's login down.
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

/** Retry Mongo with capped backoff. Never calls process.exit — no crash loops. */
async function connectWithRetry(attempt = 0): Promise<void> {
  try {
    await db();
    if (attempt > 0) console.log(`[DB] connected after ${attempt} retries`);
  } catch (error) {
    const wait = Math.min(30_000, 2 ** attempt * 1000);
    console.error(`[DB] connect failed (attempt ${attempt + 1}); retrying in ${wait}ms:`,
      (error as Error)?.message);
    setTimeout(() => void connectWithRetry(attempt + 1), wait);
  }
}

async function startServer() {
  try {
    routes(app);

    const server = http.createServer(app);
    // Bound request lifetimes so a stuck dependency can't hold a socket open forever.
    server.requestTimeout = 60_000;
    server.keepAliveTimeout = 61_000;
    server.headersTimeout = 65_000;

    registerGracefulShutdown(server);
    server.on("error", (err) => console.error("[Server] listener error:", err));

    server.listen(PORT, () => {
      console.log(`${chalk.bold.green("Environment:")} ${chalk.italic.yellow(environment)}`);
      console.log(`${chalk.bold.green("Port:")} ${chalk.blue(PORT)}`);
    });

    void connectWithRetry();
  } catch (error) {
    console.error("Failed to start service:", error);
  }
}

function registerGracefulShutdown(server: http.Server) {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ${signal} received — closing gracefully...`);

    const force = setTimeout(() => {
      console.error("[Shutdown] Forced exit after timeout.");
      process.exit(1);
    }, 25_000);
    force.unref();

    server.close();
    // Close queues / sockets / redis here as you add them.
    console.log("[Shutdown] Clean. Exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void startServer();
```

---

## 8. The auth flows

### Login with email OTP (default)

```
POST /auth/login            { email, password }
  └─ password OK → issue 6-digit code, store hashed-or-plain + 5-min expiry,
                   email it, return { method: "email", preAuthToken }
POST /auth/2fa/verify       { email, token: "123456" }
  └─ twoFAChecker → handleEmail2FA → code matches & unexpired
                  → burn code, set lastVerified
                  → return { token }   ← 12h access token
```

### Login with authenticator (TOTP)

```
POST /auth/login            { email, password }
  └─ totp.isEnabled && isVerified → return { method: "totp", preAuthToken }
POST /auth/2fa/verify       { email, token: "654321" }
  └─ twoFAChecker → handleTOTP2FA → speakeasy.totp.verify(secret, ±1 window)
                  → return { token }
```

### Enrolling an authenticator

```
POST /auth/2fa/totp/setup   Authorization: Bearer <token>
  └─ speakeasy.generateSecret() → { base32, otpauth_url }
     store base32 as twoFA.tempSecret (NOT live yet)
     return { qrcode: "data:image/png;base64,…", base32 }
                                  ↓ user scans in Google Authenticator
POST /auth/2fa/totp/verify  { token: "123456" }
  └─ verify against tempSecret → promote to twoFA.secret,
     totp.isEnabled = totp.isVerified = true, default = "totp"
```

The `tempSecret` → `secret` promotion is the important bit: a secret is never live
until the user has proved they can generate a code from it, so a failed scan can't
lock them out.

### Password reset

```
POST /auth/forgot-password  { email }
  └─ sign a 1h JWT, persist it on the user, email ${CLIENT_URL}/reset-password/<token>
POST /auth/reset-password   { token, password }
  └─ verify JWT + match stored token + check expiry
     assign user.password and .save()   ← so the pre-save hash hook runs
     clear resetPasswordToken/Expires
```

### Endpoint summary

| Method | Path | Auth | Body | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/auth/register` | – | firstName, lastName, email, password | Create account |
| POST | `/auth/login` | – | email, password | Verify password, trigger 2FA |
| POST | `/auth/2fa/verify` | – | email, token | Complete 2FA → access token |
| POST | `/auth/otp` | – | email | Resend the email OTP |
| POST | `/auth/forgot-password` | – | email | Send reset link |
| POST | `/auth/reset-password` | – | token, password | Set new password |
| GET | `/auth/me` | Bearer | – | Current session user |
| POST | `/auth/2fa/totp/setup` | Bearer | – | Get QR + pending secret |
| POST | `/auth/2fa/totp/verify` | Bearer | token | Activate authenticator |
| POST | `/auth/2fa/totp/disable` | Bearer | token | Turn authenticator off |

---

## 9. Adding a new domain — the 7-file checklist

To add e.g. `Project`, create these and touch nothing else:

1. `interfaces/project.ts` → `IProject extends Document` (+ export from `interfaces/index.ts`)
2. `models/project.ts` → schema, indexes, hooks, plugin (+ export from `models/index.ts`)
3. `repositories/project.ts` → `class ProjectRepository` (+ instantiate in `repositories/index.ts`)
4. `validations/project.ts` → `class ProjectReqSchema` (+ destructure in `validations/index.ts`)
5. `controllers/projectController.ts` → `class ProjectController` (+ instantiate in `controllers/index.ts`)
6. `routes/project.ts` → router (+ export from `routes/index.ts`)
7. `startup/routes.ts` → `app.use(`${version}/projects`, projectRouter)`

If a piece of logic spans two domains or does multi-step orchestration, put it in
`services/` and call it from the controller — don't let one controller import another's
repository beyond simple reads.

---

## 10. Hardening & extension notes

Things worth doing on a **new** backend that the original grew past:

- **Rate-limit the auth routes.** `npm i express-rate-limit` and cap `/auth/login`,
  `/auth/otp` and `/auth/2fa/verify` (e.g. 5 attempts / 15 min / IP+email). Without this,
  a 6-digit OTP is brute-forceable in minutes.
- **Hash the OTP at rest.** Store `bcrypt.hash(code)` in `otpCode` and compare on verify,
  the same way passwords are handled.
- **Add an attempt counter** (`otpAttempts`) and invalidate the code after 5 failures.
- **TOTP replay guard.** Persist the last accepted TOTP step and reject a repeat, so a
  code sniffed within its 30-second window can't be reused.
- **Encrypt `twoFA.secret` at rest** with an app-level key if the DB is shared.
- **Recovery codes.** Generate 8–10 single-use codes at TOTP enrolment; without them a
  lost phone means a manual support reset.
- **Enforce the pre-auth token.** The scaffold returns one; make `/auth/2fa/verify` require
  and verify it (`type === "pre_auth"`, email match) instead of trusting the posted email.
- **Refresh tokens.** A 12h access token is a compromise. Add a short access token +
  rotating refresh token when you need real session control.
- **Uniform error messages.** Never distinguish "user not found" from "wrong password".

Extensions that slot in without disturbing the layers:

| Want | Add | Where it plugs in |
| --- | --- | --- |
| Background jobs | `bullmq`, `ioredis` | `queues/`, started from `startup/routes.ts`, closed in the shutdown handler |
| Realtime | `socket.io` | `services/socketService.ts`, `SocketService.init(server)` in `app.ts` |
| File upload | `multer` + `@azure/storage-blob` or `cloudinary` | `middleware/UploadFiles.ts`, `utils/Storage/` |
| Sessions (OAuth state) | `express-session`, `connect-redis` | `app.ts`, before routes |
| Scheduled tasks | `node-cron` | `jobs/`, started from `startup/routes.ts` |
| Role-based access | – | `middleware/isAdmin.ts`, `middleware/permissions.ts` after `authToken` |
| Email templates | `handlebars` + `copyfiles` | `utils/emails/templates/*.hbs`; add the `copy-assets` build step |

---

## 11. Smoke test

```bash
npm run dev

curl -s localhost:8001/api/v1/health

curl -s -X POST localhost:8001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","password":"Sup3rSecret!"}'

# Step 1 — password. Returns method:"email" and mails a 6-digit code.
curl -s -X POST localhost:8001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Sup3rSecret!"}'

# Step 2 — the code from the email. Returns the 12h access token.
curl -s -X POST localhost:8001/api/v1/auth/2fa/verify \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","token":"123456"}'

# Enrol an authenticator: open the returned data-URI in a browser and scan it.
curl -s -X POST localhost:8001/api/v1/auth/2fa/totp/setup \
  -H "Authorization: Bearer $TOKEN"
```
