CREATE TABLE "cv_khusus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"persona_id" uuid,
	"lowongan_id" uuid,
	"template" text DEFAULT 'satu_kolom' NOT NULL,
	"language" text DEFAULT 'id' NOT NULL,
	"isi" jsonb NOT NULL,
	"isi_awal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"city" text NOT NULL,
	"district" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"checks" jsonb DEFAULT '{"ktp":false,"npwp":false,"foto_usaha":false}'::jsonb NOT NULL,
	"status" text DEFAULT 'belum' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "fakta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"place" text,
	"period" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"cv_khusus_id" uuid,
	"masked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lamaran" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lowongan_id" uuid NOT NULL,
	"pencari_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"cv_khusus_id" uuid,
	"pesan" text,
	"status" text DEFAULT 'terkirim' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "laporan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lowongan_id" uuid NOT NULL,
	"pelapor_id" uuid NOT NULL,
	"alasan" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lowongan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" uuid NOT NULL,
	"seed_key" text,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"segment" text DEFAULT 'informal' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"pay_type" text,
	"pay_min" integer,
	"pay_max" integer,
	"hours_per_day" real,
	"days_per_week" integer,
	"hours_text" text,
	"employment_type" text,
	"start_date" date,
	"city" text,
	"district" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"urgent_until" timestamp with time zone,
	"language" text DEFAULT 'id' NOT NULL,
	"status" text DEFAULT 'draf' NOT NULL,
	"pemeriksaan" jsonb,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "lowongan_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"fakta_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"preferensi" jsonb DEFAULT '{"kota":[]}'::jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tahap_berikutnya" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lamaran_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"demo_key" text,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"city" text NOT NULL,
	"district" text,
	"lat" double precision,
	"lng" double precision,
	"birth_year" integer,
	"education" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_demo_key_unique" UNIQUE("demo_key")
);
--> statement-breakpoint
ALTER TABLE "cv_khusus" ADD CONSTRAINT "cv_khusus_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_khusus" ADD CONSTRAINT "cv_khusus_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_khusus" ADD CONSTRAINT "cv_khusus_lowongan_id_lowongan_id_fk" FOREIGN KEY ("lowongan_id") REFERENCES "public"."lowongan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employers" ADD CONSTRAINT "employers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fakta" ADD CONSTRAINT "fakta_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_cv_khusus_id_cv_khusus_id_fk" FOREIGN KEY ("cv_khusus_id") REFERENCES "public"."cv_khusus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lamaran" ADD CONSTRAINT "lamaran_lowongan_id_lowongan_id_fk" FOREIGN KEY ("lowongan_id") REFERENCES "public"."lowongan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lamaran" ADD CONSTRAINT "lamaran_pencari_id_users_id_fk" FOREIGN KEY ("pencari_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lamaran" ADD CONSTRAINT "lamaran_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lamaran" ADD CONSTRAINT "lamaran_cv_khusus_id_cv_khusus_id_fk" FOREIGN KEY ("cv_khusus_id") REFERENCES "public"."cv_khusus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laporan" ADD CONSTRAINT "laporan_lowongan_id_lowongan_id_fk" FOREIGN KEY ("lowongan_id") REFERENCES "public"."lowongan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laporan" ADD CONSTRAINT "laporan_pelapor_id_users_id_fk" FOREIGN KEY ("pelapor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lowongan" ADD CONSTRAINT "lowongan_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tahap_berikutnya" ADD CONSTRAINT "tahap_berikutnya_lamaran_id_lamaran_id_fk" FOREIGN KEY ("lamaran_id") REFERENCES "public"."lamaran"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fakta_user_idx" ON "fakta" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lamaran_unik_idx" ON "lamaran" USING btree ("lowongan_id","pencari_id");--> statement-breakpoint
CREATE INDEX "lamaran_pencari_idx" ON "lamaran" USING btree ("pencari_id");--> statement-breakpoint
CREATE INDEX "lowongan_feed_idx" ON "lowongan" USING btree ("status","city");--> statement-breakpoint
CREATE INDEX "lowongan_employer_idx" ON "lowongan" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "lowongan_embedding_idx" ON "lowongan" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "personas_user_idx" ON "personas" USING btree ("user_id");