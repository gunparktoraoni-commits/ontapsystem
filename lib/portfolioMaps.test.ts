import { describe, expect, it } from 'vitest';
import {
  extractCoordsFromMapInput,
  hasPortfolioLocation,
  resolveGoogleMapsHref,
  resolvePortfolioMapCoords,
  resolveStoredPortfolioMapCoords,
} from '../app/lib/portfolioMaps';
import {
  hasMappableLocation,
  resolvePortfolioCardVisibility,
} from '../app/lib/portfolioDisplay';
import type { PortfolioData } from '../app/types';

const baseVcard = {
  addressHouseNo: '',
  addressArea: '',
  addressBrgy: '',
  addressCity: '',
  addressRegion: '',
  addressZipcode: '',
  addressMapLink: '',
  addressLandmark: '',
  addressLatitude: null as number | null,
  addressLongitude: null as number | null,
};

function emptyPortfolio(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    bizCard: {
      urlAlias: '',
      bizCardName: '',
      description: '',
      occupation: '',
      profileImage: null,
      coverImage: null,
      coverType: null,
      coverFileName: null,
      coverImagePosition: 'center center',
    },
    vcard: {
      firstName: '',
      middleName: '',
      lastName: '',
      professionalTitle: '',
      postNominalLetters: '',
      suffix: '',
      about: '',
      contactNumber: '',
      secondaryNumber: '',
      telephoneNumber: '',
      altTelephoneNumber: '',
      email: '',
      alternativeEmail: '',
      languages: '',
      ...baseVcard,
      socialLinks: [],
    },
    services: [],
    selectedTheme: '',
    gallery: [],
    videos: [],
    ...overrides,
  };
}

describe('portfolio map location link preference', () => {
  it('extracts coordinates from a full Google Maps URL', () => {
    const coords = extractCoordsFromMapInput(
      'https://www.google.com/maps/place/Manila/@14.5995,120.9842,17z',
    );
    expect(coords).toEqual({ latitude: 14.5995, longitude: 120.9842 });
  });

  it('extracts coordinates from q=lat,lng query links', () => {
    const coords = extractCoordsFromMapInput(
      'https://maps.google.com/?q=10.3157,123.8854',
    );
    expect(coords).toEqual({ latitude: 10.3157, longitude: 123.8854 });
  });

  it('prefers location-link coordinates over stored lat/lng', () => {
    const coords = resolvePortfolioMapCoords({
      ...baseVcard,
      addressMapLink: 'https://www.google.com/maps/@14.5995,120.9842,15z',
      addressLatitude: 1,
      addressLongitude: 2,
    });
    expect(coords).toEqual({ latitude: 14.5995, longitude: 120.9842 });
  });

  it('falls back to stored lat/lng when location link has no embedded coordinates', () => {
    const coords = resolvePortfolioMapCoords({
      ...baseVcard,
      addressMapLink: 'https://maps.app.goo.gl/abc123',
      addressLatitude: 14.5995,
      addressLongitude: 120.9842,
    });
    expect(coords).toEqual({ latitude: 14.5995, longitude: 120.9842 });
    expect(
      resolveStoredPortfolioMapCoords({
        addressLatitude: 14.5995,
        addressLongitude: 120.9842,
      }),
    ).toEqual({ latitude: 14.5995, longitude: 120.9842 });
  });

  it('prefers coordinates embedded in the location link over stored lat/lng', () => {
    const coords = resolvePortfolioMapCoords({
      ...baseVcard,
      addressMapLink: 'https://www.google.com/maps/@10.3157,123.8854,15z',
      addressLatitude: 14.5995,
      addressLongitude: 120.9842,
    });
    expect(coords).toEqual({ latitude: 10.3157, longitude: 123.8854 });
  });

  it('falls back to stored lat/lng only when no location link exists', () => {
    const coords = resolvePortfolioMapCoords({
      ...baseVcard,
      addressMapLink: '',
      addressLatitude: 14.5995,
      addressLongitude: 120.9842,
    });
    expect(coords).toEqual({ latitude: 14.5995, longitude: 120.9842 });
  });

  it('resolveGoogleMapsHref uses the location link directly', () => {
    const href = resolveGoogleMapsHref({
      ...baseVcard,
      firstName: '',
      lastName: '',
      email: '',
      contactNumber: '',
      professionalTitle: '',
      bio: '',
      profileImg: '',
      coverImg: '',
      company: '',
      addressMapLink: 'https://maps.app.goo.gl/abc123',
      addressLatitude: 14.5995,
      addressLongitude: 120.9842,
    } as any);
    expect(href).toBe('https://maps.app.goo.gl/abc123');
  });

  it('hasPortfolioLocation is true when only a location link exists', () => {
    expect(
      hasPortfolioLocation({
        addressMapLink: 'https://maps.app.goo.gl/abc123',
        addressLatitude: null,
        addressLongitude: null,
      }),
    ).toBe(true);
  });

  it('hasPortfolioLocation is false when neither link nor coords exist', () => {
    expect(
      hasPortfolioLocation({
        addressMapLink: '',
        addressLatitude: null,
        addressLongitude: null,
      }),
    ).toBe(false);
  });

  it('hasMappableLocation is false for city-only data and true for map-link-only', () => {
    expect(
      hasMappableLocation({
        ...baseVcard,
        addressCity: 'Manila',
      } as any),
    ).toBe(false);
    expect(
      hasMappableLocation({
        ...baseVcard,
        addressMapLink: 'https://maps.app.goo.gl/abc123',
      } as any),
    ).toBe(true);
  });

  it('ignores mismatched stored coordinates when building open-maps href from a link', () => {
    const href = resolveGoogleMapsHref({
      ...baseVcard,
      addressMapLink: 'https://www.google.com/maps/@10.3157,123.8854,15z',
      addressLatitude: 14.5995,
      addressLongitude: 120.9842,
    } as any);
    expect(href).toBe('https://www.google.com/maps/@10.3157,123.8854,15z');
  });

  it('falls back to coordinate query href when only stored coords exist', () => {
    const href = resolveGoogleMapsHref({
      ...baseVcard,
      addressMapLink: '',
      addressLatitude: 14.5995,
      addressLongitude: 120.9842,
    } as any);
    expect(href).toContain('14.599500');
    expect(href).toContain('120.984200');
  });
});

describe('resolvePortfolioCardVisibility', () => {
  it('shows location for map-link-only portfolios even without city', () => {
    const visibility = resolvePortfolioCardVisibility(
      emptyPortfolio({
        vcard: {
          ...emptyPortfolio().vcard,
          addressMapLink: 'https://maps.app.goo.gl/abc123',
          addressCity: '',
        },
      }),
    );
    expect(visibility.location).toBe(true);
  });

  it('hides location when only street/city text exists', () => {
    const visibility = resolvePortfolioCardVisibility(
      emptyPortfolio({
        vcard: {
          ...emptyPortfolio().vcard,
          addressCity: 'Makati',
          addressBrgy: 'Poblacion',
          addressMapLink: '',
        },
      }),
    );
    expect(visibility.location).toBe(false);
  });

  it('shows about/contact/services/socials/gallery only when data exists', () => {
    const empty = resolvePortfolioCardVisibility(emptyPortfolio());
    expect(empty).toMatchObject({
      about: false,
      contact: false,
      socials: false,
      services: false,
      gallery: false,
      videos: false,
      location: false,
      inquiry: false,
    });

    const base = emptyPortfolio();
    const filled = resolvePortfolioCardVisibility(
      emptyPortfolio({
        inquiryEnabled: true,
        galleryAvailable: true,
        bizCard: {
          ...base.bizCard,
          description: 'Hello world',
        },
        vcard: {
          ...base.vcard,
          email: 'a@b.com',
          addressMapLink: 'https://maps.app.goo.gl/x',
          socialLinks: [{ id: 1, platform: 'facebook', url: 'https://facebook.com/x' }],
        },
        services: [
          {
            id: 1,
            title: 'Design',
            tagline: '',
            description: '',
            featured_image: null,
            videoUrl: '',
            videoFile: null,
          },
        ],
        gallery: [{ id: 1, url: 'https://cdn.example/a.jpg', title: '', description: '' }],
        videos: [
          {
            id: 1,
            title: '',
            description: '',
            fileName: 'a.mp4',
            fileSize: 1,
            videoDataUrl: 'https://cdn.example/a.mp4',
          },
        ],
      }),
    );

    expect(filled).toMatchObject({
      about: true,
      contact: true,
      socials: true,
      services: true,
      gallery: true,
      videos: true,
      location: true,
      inquiry: true,
    });
  });
});
