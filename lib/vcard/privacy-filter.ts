export type DetailsInput = {
  email_address: string | null;
  phone_number: string | null;
  alternative_email: string | null;
  alternative_number: string | null;
};

export type DetailsVisibility = {
  email_address: boolean;
  phone_number: boolean;
  alternative_email: boolean;
  alternative_number: boolean;
};

export function buildVisibilityFlags(isOwner: boolean): DetailsVisibility {
  if (isOwner) {
    return {
      email_address: true,
      phone_number: true,
      alternative_email: true,
      alternative_number: true,
    };
  }

  return {
    email_address: false,
    phone_number: false,
    alternative_email: false,
    alternative_number: false,
  };
}

export function applyDetailsPrivacy(input: DetailsInput, isOwner: boolean): DetailsInput {
  if (isOwner) return input;

  return {
    email_address: null,
    phone_number: null,
    alternative_email: null,
    alternative_number: null,
  };
}
