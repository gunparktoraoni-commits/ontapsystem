import type { User } from "@prisma/client";
import { generateUrlAlias } from "@/lib/bizcard/generator";

export type LegacyUserVcardSubset = Pick<
  User,
  | "user_id"
  | "serial_id"
  | "custom_uri"
  | "first_name"
  | "middle_name"
  | "last_name"
  | "job_position"
  | "prof_title"
  | "post_nominal"
  | "suffix"
  | "about"
  | "email"
  | "contact"
  | "alt_email"
  | "alt_contact"
  | "profile_url"
  | "cover_url"
  | "company_id"
  | "is_active"
  | "created_at"
  | "updated_at"
> & {
  telephone?: string | null;
  alt_telephone?: string | null;
};

export function mapUserToBizcardCreateData(user: LegacyUserVcardSubset) {
  return {
    user_id: user.user_id,
    bizcard_name: `${user.first_name} ${user.last_name}`.trim(),
    serial_id: null,
    url_alias: user.custom_uri ?? generateUrlAlias(user.first_name, user.last_name, user.user_id),
    description: user.about,
    first_name: user.first_name,
    middle_name: user.middle_name,
    last_name: user.last_name,
    occupation: user.job_position,
    professional_title: user.prof_title,
    post_nominal: user.post_nominal,
    suffix: user.suffix,
    city: "",
    company_id: user.company_id,
    bio: user.about,
    email: user.email,
    contact_number: user.contact ?? "",
    alt_email: user.alt_email,
    alt_contact_number: user.alt_contact,
    telephone_number: user.telephone ?? null,
    alt_telephone_number: user.alt_telephone ?? null,
    profile_img: user.profile_url,
    cover_img: user.cover_url,
    bizcard_theme: null,
    deactivated_flag: !user.is_active,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}
