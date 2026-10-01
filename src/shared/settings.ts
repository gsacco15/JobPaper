import { DEFAULT_TERMS, type Business } from "./document.js";

/** Plugin settings (business defaults). Every field always has a value. */
export interface BusinessSettings {
  business_name: string;
  phone: string;
  email: string;
  logo_data_url: string;
  default_markup_pct: number;
  default_tax_pct: number;
  default_terms: string;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  business_name: "",
  phone: "",
  email: "",
  logo_data_url: "",
  default_markup_pct: 0,
  default_tax_pct: 0,
  default_terms: DEFAULT_TERMS,
};

/** Logos are stored as small data URLs; the panel downsizes before saving. */
export const MAX_LOGO_DATA_URL_LENGTH = 200_000;

export function businessFromSettings(s: BusinessSettings): Business {
  return {
    name: s.business_name,
    phone: s.phone,
    email: s.email,
    logo_data_url: s.logo_data_url,
  };
}

export function settingsHints(s: BusinessSettings): string[] {
  const hints: string[] = [];
  if (!s.business_name.trim() || !s.phone.trim()) {
    hints.push("Add your business name and phone in JobPaper settings so they print on every PDF.");
  }
  if (s.default_markup_pct === 0 && s.default_tax_pct === 0) {
    hints.push("Markup and tax are 0%. Tap either one to set it — JobPaper remembers.");
  }
  return hints;
}

/** Fill gaps with defaults and coerce types, so reads always return every field. */
export function completeSettings(partial: Partial<BusinessSettings> | null | undefined): BusinessSettings {
  const p = partial ?? {};
  const str = (v: unknown, fallback: string, max: number) => (typeof v === "string" ? v.slice(0, max) : fallback);
  const pct = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0;
  };
  const logo = str(p.logo_data_url, "", MAX_LOGO_DATA_URL_LENGTH + 1);
  return {
    business_name: str(p.business_name, DEFAULT_SETTINGS.business_name, 120),
    phone: str(p.phone, DEFAULT_SETTINGS.phone, 40),
    email: str(p.email, DEFAULT_SETTINGS.email, 120),
    logo_data_url:
      logo.length <= MAX_LOGO_DATA_URL_LENGTH && (logo === "" || /^data:image\/(png|jpeg|webp);base64,/.test(logo))
        ? logo
        : "",
    default_markup_pct: pct(p.default_markup_pct ?? DEFAULT_SETTINGS.default_markup_pct),
    default_tax_pct: pct(p.default_tax_pct ?? DEFAULT_SETTINGS.default_tax_pct),
    default_terms: str(p.default_terms, DEFAULT_SETTINGS.default_terms, 2000),
  };
}
