import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type Peran = "pencari" | "pemberi";

/** Akun Lokerin. Untuk lomba, semua akun adalah akun demo yang masuk dengan satu ketukan. */
export const users = pgTable("users", {
  id: id(),
  role: text("role").$type<Peran>().notNull(),
  demoKey: text("demo_key").unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  /** Sub (ID akun) Google; diisi saat pengguna masuk dengan Google. */
  googleSub: text("google_sub").unique(),
  city: text("city").notNull(),
  district: text("district"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  birthYear: integer("birth_year"),
  education: text("education"),
  createdAt: createdAt(),
});

export type CekVerifikasi = { ktp: boolean; npwp: boolean; foto_usaha: boolean };

export const employers = pgTable("employers", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  kind: text("kind").$type<"umkm" | "perusahaan" | "rumah_tangga">().notNull(),
  description: text("description"),
  city: text("city").notNull(),
  district: text("district"),
  address: text("address"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  checks: jsonb("checks").$type<CekVerifikasi>().notNull().default({ ktp: false, npwp: false, foto_usaha: false }),
  status: text("status").$type<"belum" | "menunggu" | "terverifikasi">().notNull().default("belum"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export type JenisFakta = "pengalaman" | "keahlian" | "pendidikan" | "prestasi" | "lainnya";

/** Satu hal tentang Pencari Kerja. Hanya Fakta berstatus `terkonfirmasi` yang boleh dipakai AI. */
export const fakta = pgTable(
  "fakta",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<JenisFakta>().notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    place: text("place"),
    period: text("period"),
    status: text("status").$type<"usulan" | "terkonfirmasi" | "ditolak">().notNull(),
    source: text("source").$type<"obrolan" | "suara" | "formulir" | "cv">().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("fakta_user_idx").on(table.userId, table.status)],
);

export type Preferensi = {
  kota: string[];
  upah_min?: number;
  upah_satuan?: "harian" | "bulanan";
  mulai?: string;
  jenis_kerja?: string[];
  mau_pindah?: boolean;
};

export const personas = pgTable(
  "personas",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    faktaIds: uuid("fakta_ids").array().notNull().default(sql`'{}'::uuid[]`),
    preferensi: jsonb("preferensi").$type<Preferensi>().notNull().default({ kota: [] }),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("personas_user_idx").on(table.userId)],
);

export type JenisUpah = "harian" | "mingguan" | "bulanan" | "borongan" | "per_jam";
export type StatusLowongan = "draf" | "terbit" | "terisi" | "disembunyikan";

export type HasilPemeriksaan = {
  boleh_terbit: boolean;
  masalah: { kode: string; tingkat: "tahan" | "peringatan"; pesan: string; field?: string }[];
  diperiksa_pada: string;
};

export const lowongan = pgTable(
  "lowongan",
  {
    id: id(),
    employerId: uuid("employer_id")
      .notNull()
      .references(() => employers.id, { onDelete: "cascade" }),
    seedKey: text("seed_key").unique(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    segment: text("segment").$type<"informal" | "magang">().notNull().default("informal"),
    description: text("description").notNull().default(""),
    requirements: text("requirements").array().notNull().default(sql`'{}'::text[]`),
    payType: text("pay_type").$type<JenisUpah>(),
    payMin: integer("pay_min"),
    payMax: integer("pay_max"),
    hoursPerDay: real("hours_per_day"),
    daysPerWeek: integer("days_per_week"),
    hoursText: text("hours_text"),
    employmentType: text("employment_type"),
    startDate: date("start_date"),
    city: text("city"),
    district: text("district"),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    urgentUntil: timestamp("urgent_until", { withTimezone: true }),
    language: text("language").$type<"id" | "en">().notNull().default("id"),
    status: text("status").$type<StatusLowongan>().notNull().default("draf"),
    pemeriksaan: jsonb("pemeriksaan").$type<HasilPemeriksaan>(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("lowongan_feed_idx").on(table.status, table.city),
    index("lowongan_employer_idx").on(table.employerId),
    index("lowongan_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export type ItemCv = { id: string; text: string; fakta_ids: string[]; diedit_pengguna?: boolean };
export type BagianCv = { id: string; judul: string; items: ItemCv[] };
export type IsiCv = {
  nama: string;
  judul: string;
  kontak: { telepon?: string; email?: string; kota?: string };
  ringkasan: string;
  keahlian: string[];
  bagian: BagianCv[];
};

export const cvKhusus = pgTable("cv_khusus", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  personaId: uuid("persona_id").references(() => personas.id, { onDelete: "set null" }),
  lowonganId: uuid("lowongan_id").references(() => lowongan.id, { onDelete: "set null" }),
  template: text("template").$type<"satu_kolom" | "dua_kolom">().notNull().default("satu_kolom"),
  language: text("language").$type<"id" | "en">().notNull().default("id"),
  isi: jsonb("isi").$type<IsiCv>().notNull(),
  isiAwal: jsonb("isi_awal").$type<IsiCv>().notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StatusLamaran = "terkirim" | "dilihat" | "lolos" | "tidak_lolos";

export const lamaran = pgTable(
  "lamaran",
  {
    id: id(),
    lowonganId: uuid("lowongan_id")
      .notNull()
      .references(() => lowongan.id, { onDelete: "cascade" }),
    pencariId: uuid("pencari_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "restrict" }),
    cvKhususId: uuid("cv_khusus_id").references(() => cvKhusus.id, { onDelete: "set null" }),
    pesan: text("pesan"),
    status: text("status").$type<StatusLamaran>().notNull().default("terkirim"),
    createdAt: createdAt(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("lamaran_unik_idx").on(table.lowonganId, table.pencariId),
    index("lamaran_pencari_idx").on(table.pencariId),
  ],
);

export const tahapBerikutnya = pgTable("tahap_berikutnya", {
  id: id(),
  lamaranId: uuid("lamaran_id")
    .notNull()
    .references(() => lamaran.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"whatsapp" | "meet" | "alamat" | "lainnya">().notNull(),
  detail: text("detail").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  note: text("note"),
  createdAt: createdAt(),
});

/** Berkas kecil untuk demo (PDF CV). Untuk final, isi berkas pindah ke Azure Blob. */
export const files = pgTable("files", {
  id: id(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"cv_pdf" | "verifikasi">().notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  cvKhususId: uuid("cv_khusus_id").references(() => cvKhusus.id, { onDelete: "cascade" }),
  masked: boolean("masked").notNull().default(false),
  createdAt: createdAt(),
});

export const laporan = pgTable("laporan", {
  id: id(),
  lowonganId: uuid("lowongan_id")
    .notNull()
    .references(() => lowongan.id, { onDelete: "cascade" }),
  pelaporId: uuid("pelapor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  alasan: text("alasan").notNull(),
  createdAt: createdAt(),
});
