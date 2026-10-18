import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { employers, fakta, lowongan, personas, users, type JenisFakta, type JenisUpah, type Preferensi } from "../db/schema.js";
import { createModels } from "../ai/models.js";
import { periksaDraf } from "../domain/pemeriksaan.js";
import { embedLowongan } from "../domain/matching.js";

type SeedEmployer = {
  key: string;
  owner_name: string;
  business_name: string;
  kind: "umkm" | "perusahaan" | "rumah_tangga";
  city: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  description: string;
  checks: { ktp: boolean; npwp: boolean; foto_usaha: boolean };
  status: "terverifikasi" | "belum";
  verified_at: string | null;
};

type SeedLowongan = {
  key: string;
  employer_key: string;
  title: string;
  category: string;
  segment: "informal" | "magang";
  description: string;
  requirements: string[];
  pay_type: JenisUpah;
  pay_min: number;
  pay_max: number;
  hours_per_day: number;
  days_per_week: number;
  hours_text: string;
  employment_type: string;
  start_date: string;
  city: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  urgent_hours: number | null;
  language: "id" | "en";
};

type SeedPencari = {
  key: string;
  name: string;
  city: string;
  district: string;
  phone: string;
  email: string;
  birth_year: number;
  education: string;
  fakta: { kind: JenisFakta; title: string; detail?: string; place?: string; period?: string }[];
  personas: { title: string; summary: string; skills: string[]; fakta_index: number[]; preferensi: Preferensi }[];
};

const read = <T>(name: string) => JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), "utf8")) as T;

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const models = createModels(env);

try {
  const pemberi = read<SeedEmployer[]>("pemberi-kerja.json");
  const daftarLowongan = read<SeedLowongan[]>("lowongan.json");
  const pencari = read<SeedPencari[]>("pencari-kerja.json");

  // Data demo diatur ulang setiap seed; memori percakapan Mastra ada di skema terpisah.
  await db.execute(sql`truncate table users cascade`);

  const employerIds = new Map<string, string>();
  for (const item of pemberi) {
    const [user] = await db
      .insert(users)
      .values({ role: "pemberi", demoKey: item.key, name: item.owner_name, phone: item.phone, city: item.city, district: item.district, lat: item.lat, lng: item.lng })
      .returning();
    if (!user) throw new Error(`Gagal membuat akun ${item.key}`);
    const [employer] = await db
      .insert(employers)
      .values({
        userId: user.id,
        businessName: item.business_name,
        kind: item.kind,
        description: item.description,
        city: item.city,
        district: item.district,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        checks: item.checks,
        status: item.status,
        verifiedAt: item.verified_at ? new Date(item.verified_at) : null,
      })
      .returning();
    if (!employer) throw new Error(`Gagal membuat pemberi kerja ${item.key}`);
    employerIds.set(item.key, employer.id);
  }
  console.log(`Pemberi Kerja: ${employerIds.size}`);

  const now = Date.now();
  const inserted: string[] = [];
  for (const [index, item] of daftarLowongan.entries()) {
    const employerId = employerIds.get(item.employer_key);
    if (!employerId) throw new Error(`Pemberi kerja ${item.employer_key} tidak ada untuk ${item.key}`);
    const columns = {
      title: item.title,
      category: item.category,
      segment: item.segment,
      description: item.description,
      requirements: item.requirements,
      payType: item.pay_type,
      payMin: item.pay_min,
      payMax: item.pay_max,
      hoursPerDay: item.hours_per_day,
      daysPerWeek: item.days_per_week,
      hoursText: item.hours_text,
      employmentType: item.employment_type,
      startDate: item.start_date,
      city: item.city,
      district: item.district,
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      language: item.language,
    };
    const pemeriksaan = periksaDraf({ ...columns, segment: item.segment });
    const [row] = await db
      .insert(lowongan)
      .values({
        ...columns,
        employerId,
        seedKey: item.key,
        urgentUntil: item.urgent_hours ? new Date(now + item.urgent_hours * 3600_000) : null,
        status: pemeriksaan.boleh_terbit ? "terbit" : "draf",
        pemeriksaan,
        publishedAt: pemeriksaan.boleh_terbit ? new Date(now - (index % 12) * 3600_000 - index * 60_000) : null,
      })
      .returning({ id: lowongan.id });
    if (row) inserted.push(row.id);
  }
  for (let start = 0; start < inserted.length; start += 25) {
    await embedLowongan(db, models, inserted.slice(start, start + 25));
  }
  console.log(`Lowongan: ${inserted.length} (dengan embedding)`);

  for (const item of pencari) {
    const [user] = await db
      .insert(users)
      .values({
        role: "pencari",
        demoKey: item.key,
        name: item.name,
        phone: item.phone,
        email: item.email,
        city: item.city,
        district: item.district,
        birthYear: item.birth_year,
        education: item.education,
      })
      .returning();
    if (!user) throw new Error(`Gagal membuat akun ${item.key}`);
    const faktaRows = await db
      .insert(fakta)
      .values(
        item.fakta.map((entry) => ({
          userId: user.id,
          kind: entry.kind,
          title: entry.title,
          detail: entry.detail ?? null,
          place: entry.place ?? null,
          period: entry.period ?? null,
          status: "terkonfirmasi" as const,
          source: "formulir" as const,
          confirmedAt: new Date(),
        })),
      )
      .returning({ id: fakta.id });
    for (const persona of item.personas) {
      const faktaIds = persona.fakta_index.map((i) => faktaRows[i]?.id).filter((id): id is string => Boolean(id));
      const embedding = await models.embed(`${persona.title}. ${persona.summary}. Keahlian: ${persona.skills.join(", ")}`);
      await db.insert(personas).values({
        userId: user.id,
        title: persona.title,
        summary: persona.summary,
        skills: persona.skills,
        faktaIds,
        preferensi: persona.preferensi,
        embedding,
      });
    }
    console.log(`Pencari Kerja ${item.key}: ${faktaRows.length} Fakta, ${item.personas.length} Persona`);
  }
} finally {
  await pool.end();
}
