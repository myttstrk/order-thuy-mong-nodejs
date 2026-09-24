import tshirt from "@/assets/merch-tshirt.jpg";
import tote from "@/assets/merch-tote.jpg";
import fan from "@/assets/merch-fan.jpg";
import keychain from "@/assets/merch-keychain.jpg";

export const MERCH_IMAGES: Record<string, string> = {
  tshirt,
  tote,
  fan,
  keychain,
};

export interface TicketTier {
  code: string;
  name: string;
  price: number;
  tagline: string;
  perks: string[];
}

export interface MerchItem {
  code: string;
  name: string;
  description: string;
  price: number;
  image_key: string;
}

export interface Catalog {
  tiers: TicketTier[];
  merch: MerchItem[];
}
