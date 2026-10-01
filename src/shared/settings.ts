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
