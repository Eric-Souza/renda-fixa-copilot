CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"subject" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_date_unique" UNIQUE("date")
);
