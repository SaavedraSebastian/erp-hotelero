import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { RoleId, RolePermissions } from './types.ts';

export interface DbUserRow {
  id: string;
  name: string;
  email: string;
  role: RoleId;
  role_label: string;
  department: string;
  shift: string;
  assigned_staff_id: string | null;
  avatar_url: string | null;
  password_hash: string;
  salt: string;
  active: number;
  created_at: string;
}

interface SeedUserRecord {
  id: string;
  name: string;
  email: string;
  role: RoleId;
  roleLabel: string;
  department: string;
  shift: string;
  assignedStaffId?: string;
  avatarUrl?: string;
  envOverrideKey: string;
  salt: string;
  passwordHash: string;
}

const SEED_USERS: SeedUserRecord[] = [
  {
    id: 'usr-01',
    name: 'Carlos Mendoza',
    email: 'admin@hotelazure.pe',
    role: 'admin',
    roleLabel: 'Administrador del sistema',
    department: 'Dirección y Gobierno TI',
    shift: 'Completo',
    avatarUrl: '/src/assets/images/avatar-director-hotel.jpg',
    envOverrideKey: 'DEMO_PWD_ADMIN',
    salt: 'b8e70af4cefab6760abeff2db1e94520',
    passwordHash:
      'fe57b8509d2b4e5b169c45f7d70d4f54a8f1df627cfe3b73232d1c805c2815d1fffb004ed8c50c5ac396240101ef9d5b0d3aadef771a060de5d719d9f11c9b0e',
  },
  {
    id: 'usr-02',
    name: 'Valeria Paredes',
    email: 'recepcion@hotelazure.pe',
    role: 'recepcionista',
    roleLabel: 'Recepcionista',
    department: 'Front Desk · Reservas y Recepción',
    shift: 'Mañana',
    envOverrideKey: 'DEMO_PWD_RECEP',
    salt: '971c8c21669d92d745f77841d412295e',
    passwordHash:
      '4bdcf35e22772523e8b42caeb4803bdc4321356adccc80eab40997c2dd16f825fc04b5da890675d27d41a8e38f9fa0b1ef45b21c9b41d9755f1aaa8931cc0f32',
  },
  {
    id: 'usr-03',
    name: 'Rosa Quispe',
    email: 'supervisor.hk@hotelazure.pe',
    role: 'supervisor_hk',
    roleLabel: 'Supervisor de Housekeeping',
    department: 'Ama de Llaves · Operaciones',
    shift: 'Mañana',
    assignedStaffId: 'stf-1',
    envOverrideKey: 'DEMO_PWD_HOUSE',
    salt: 'c96500711966eae9394feb0296e2b8e2',
    passwordHash:
      'b5aedb10f0d8b67a91b8aeaec5b2bb084ffd0e5062e43843c240c91f3b156f259aa0499d4d95166649b9c31ff1812720af9c82cb9bdebcb39d1e35c3e3b6c675',
  },
  {
    id: 'usr-04',
    name: 'Elena Huamán',
    email: 'limpieza@hotelazure.pe',
    role: 'limpieza',
    roleLabel: 'Personal de limpieza',
    department: 'Housekeeping · Pisos 1 y 2',
    shift: 'Mañana',
    assignedStaffId: 'stf-2',
    envOverrideKey: 'DEMO_PWD_LIMP',
    salt: 'a9c505500714c9fcc1521d6639c25877',
    passwordHash:
      '8106da56c65b4c43ea50d26e1af5e4f8c6e61488b0cdf723c37addbbfcb799b73a75179947151ec6be59ae7b1f6580be74acd8cee4c4e03995c136d4146dfaa3',
  },
  {
    id: 'usr-05',
    name: 'Jorge Salazar',
    email: 'tecnico@hotelazure.pe',
    role: 'tecnico',
    roleLabel: 'Técnico de mantenimiento',
    department: 'Ingeniería y Mantenimiento',
    shift: 'Mañana',
    assignedStaffId: 'stf-4',
    envOverrideKey: 'DEMO_PWD_MANT',
    salt: '8f83bfe098f544aa96cc363e6912a139',
    passwordHash:
      '2b13f6fcdf26974a0254a79646615da7d1f951ebbb6f0407619fdf2636d4b1a268e57a0a945f0383570ff30059f8870e4ee2eec375106459ce6740964b4c266a',
  },
  {
    id: 'usr-06',
    name: 'Ricardo Soto',
    email: 'servicios@hotelazure.pe',
    role: 'admin_servicios',
    roleLabel: 'Administrador de Servicios',
    department: 'Dirección de A&B y Servicios',
    shift: 'Completo',
    envOverrideKey: 'DEMO_PWD_SERV',
    salt: 'c968e4aa2f4a1eea8e591de1b5c2b0b4',
    passwordHash:
      '994be24404c53ab9e2675bbf3cea287e211333b079ecd95bb08d9b6c2a89b700f25908d7ec48346b721bf9538596662451f7c6ccf5ea070636019bd1ff52e9dc',
  },
  {
    id: 'usr-07',
    name: 'Diego Ríos',
    email: 'pos@hotelazure.pe',
    role: 'pos',
    roleLabel: 'Personal de Restaurante / POS',
    department: 'Restaurante y Room Service',
    shift: 'Tarde',
    envOverrideKey: 'DEMO_PWD_POS',
    salt: '677f955fcbe717743b92f85d11918454',
    passwordHash:
      '7e327a602a73eab7cbd4699ffa1f30ce8825f8f2746138709f2f6b2c1b976fbb0d4bc6c3385d1ea8c8de161421b6f0f9e22823223244cbda6d6c7a7d8fda099c',
  },
  {
    id: 'usr-08',
    name: 'Lucía Fernández',
    email: 'almacen@hotelazure.pe',
    role: 'almacen',
    roleLabel: 'Responsable de Almacén',
    department: 'Logística e Inventarios',
    shift: 'Mañana',
    envOverrideKey: 'DEMO_PWD_ALMA',
    salt: '002e4a423e501009b59849d645f306f6',
    passwordHash:
      '5de567f302a5f66ff13c8a502b0f8304e07287bd978e2495e385c96226df4b5ebb036234f61e7e2970bbc4d8a12e5dd33b7cb20fc82238dfe34686ddd631b987',
  },
  {
    id: 'usr-09',
    name: 'Martín Chávez',
    email: 'compras@hotelazure.pe',
    role: 'compras',
    roleLabel: 'Responsable de Compras',
    department: 'Abastecimiento y Proveedores',
    shift: 'Mañana',
    envOverrideKey: 'DEMO_PWD_COMP',
    salt: 'fabe9982362d0769374677fec4e2a230',
    passwordHash:
      'a1bce975185adfe55a2d94a7af2a2e442d47f6e6b10220db5809b6a5e8132b65c7ff625b9c9d605be24f47dfa92adecb1af0b0bf800b65f7fb6cb8d7af9f8f5b',
  },
  {
    id: 'usr-10',
    name: 'Mateo Vargas',
    email: 'cajero@hotelazure.pe',
    role: 'cajero',
    roleLabel: 'Cajero',
    department: 'Caja y Facturación',
    shift: 'Mañana',
    envOverrideKey: 'DEMO_PWD_CAJA',
    salt: 'b79f20118a354ef623a5f789d2b2184a',
    passwordHash:
      '7ed23aaf15f4a44967dae9ecdff9d2fd89125793be01a292001229f73fea2102060230fcc360f88f01a755a3ef802f335f62421f4faa0bc7d7adcb9198c37d65',
  },
  {
    id: 'usr-11',
    name: 'Claudia Navarro',
    email: 'costos@hotelazure.pe',
    role: 'costos',
    roleLabel: 'Responsable de Costos',
    department: 'Control de Costos y Gastos',
    shift: 'Completo',
    envOverrideKey: 'DEMO_PWD_COST',
    salt: 'e8ba7752949350f70a90e0e89bd9c350',
    passwordHash:
      '952722764975912a6355360614b0c89a5c872e857bb26388fccec896d02684e1fd6616a8170dd71e3150e47b4bf0fb5fc9055458c110d6469bfda0ef2703a628',
  },
  {
    id: 'usr-12',
    name: 'Andrea Castillo',
    email: 'jefe.finanzas@hotelazure.pe',
    role: 'jefe_finanzas',
    roleLabel: 'Jefe de Finanzas',
    department: 'Contabilidad y Supervisión Financiera',
    shift: 'Completo',
    envOverrideKey: 'DEMO_PWD_FINA',
    salt: 'c7574d64ae0ede2fc170cb84d60af554',
    passwordHash:
      'b3da9e1f422e572c390d46bef489635a588af9f0e95ad8cc8709b716c6059695b22e6c86bdbda5d215b09f0fef99011b317312aa59d152f5949a5b9b5dcb37c7',
  },
  {
    id: 'usr-13',
    name: 'Eduardo Miranda',
    email: 'gerente.finanzas@hotelazure.pe',
    role: 'gerente_finanzas',
    roleLabel: 'Gerente Financiero',
    department: 'Gerencia Financiera',
    shift: 'Completo',
    envOverrideKey: 'DEMO_PWD_GERE',
    salt: 'dbf4b7bf1d47e00d9e8157e798b12913',
    passwordHash:
      'e3bd527ca65b4d599db3a21d8f79ec5254142f571d56204193e66238935697ac9fafc0ccbac1fd4bdf6667ac788a43d9be75e49516279571bbc71fd1f8f1de02',
  },
  {
    id: 'usr-14',
    name: 'Sofía Herrera',
    email: 'atencion@hotelazure.pe',
    role: 'atencion',
    roleLabel: 'Agente de Atención',
    department: 'Atención al Huésped y Concierge',
    shift: 'Mañana',
    envOverrideKey: 'DEMO_PWD_ATEN',
    salt: '441be0aa6c9ea10990fb8f9fd540dbaa',
    passwordHash:
      'dc6d28c47e11e84bf5c4ee474871763aa82c99c87209fd1b9e4a1aefcfb930d98d57280bcabb60487d703769aec4c52dc9f2202e36e78652a7a378a024bb623a',
  },
  {
    id: 'usr-15',
    name: 'Paola Delgado',
    email: 'comercial@hotelazure.pe',
    role: 'comercial',
    roleLabel: 'Administrador Comercial',
    department: 'CRM, Fidelización y Campañas',
    shift: 'Completo',
    envOverrideKey: 'DEMO_PWD_COME',
    salt: 'ea70600cb3296ea3db7b649e1956e9a7',
    passwordHash:
      '2e7e660a96d8bdc8220aa2d91e257fc706a44e60dd89157739ad5d9a6b5653cf0b867183719a9c76f6ce0825a53794b6af20e90c4d1d7f612bc61e548829077e',
  },
  {
    id: 'usr-16',
    name: 'Fernando León',
    email: 'auditor@hotelazure.pe',
    role: 'auditor',
    roleLabel: 'Auditor',
    department: 'Auditoría Interna · Solo Lectura',
    shift: 'Completo',
    envOverrideKey: 'DEMO_PWD_AUDI',
    salt: '24ed3ee0b8817c38a976b00493fd13f6',
    passwordHash:
      '640035485a07ad4ae46b61df689ec300717d5dce26d0179ec900fd726b88bc71593c711bc65ac89dfe861d553f1f6adc0223b12b46e06073deef5dbd3491a966',
  },
];

let dbInstance: DatabaseSync | null = null;
const DB_DIR = path.resolve(process.cwd(), 'data');
export const DB_PATH = path.join(DB_DIR, 'sgh_erp.db');

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    try {
      fs.mkdirSync(DB_DIR, { recursive: true });
      dbInstance = new DatabaseSync(DB_PATH);
    } catch {
      const tmpDir = path.join('/tmp', 'sgh_erp_data');
      try {
        fs.mkdirSync(tmpDir, { recursive: true });
        dbInstance = new DatabaseSync(path.join(tmpDir, 'sgh_erp.db'));
      } catch {
        dbInstance = new DatabaseSync(':memory:');
      }
    }
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
  }
  return dbInstance;
}

export function initDatabase(defaultPermissions: Record<RoleId, RolePermissions>): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      role_label TEXT NOT NULL,
      department TEXT NOT NULL,
      shift TEXT NOT NULL,
      assigned_staff_id TEXT,
      avatar_url TEXT,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT PRIMARY KEY,
      permissions_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS erp_snapshots (
      tenant_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const nowIso = new Date().toISOString();

  const upsertUserStmt = db.prepare(`
    INSERT INTO users (
      id, name, email, role, role_label, department, shift,
      assigned_staff_id, avatar_url, password_hash, salt, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      role = excluded.role,
      role_label = excluded.role_label,
      department = excluded.department,
      shift = excluded.shift,
      assigned_staff_id = excluded.assigned_staff_id,
      avatar_url = excluded.avatar_url,
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      active = 1
  `);

  const insertRolePermStmt = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role, permissions_json, updated_at)
    VALUES (?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const u of SEED_USERS) {
      const envPwd = process.env[u.envOverrideKey];
      const salt = envPwd ? crypto.randomBytes(16).toString('hex') : u.salt;
      const passwordHash = envPwd ? hashPassword(envPwd, salt) : u.passwordHash;

      upsertUserStmt.run(
        u.id,
        u.name,
        u.email.toLowerCase(),
        u.role,
        u.roleLabel,
        u.department,
        u.shift,
        u.assignedStaffId ?? null,
        u.avatarUrl ?? null,
        passwordHash,
        salt,
        nowIso
      );
    }

    for (const [role, perms] of Object.entries(defaultPermissions) as Array<[RoleId, RolePermissions]>) {
      insertRolePermStmt.run(role, JSON.stringify(perms), nowIso);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Purge expired sessions at startup
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
