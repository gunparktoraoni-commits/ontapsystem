// types/analytics.ts

export interface AnalyticsSummary {
  total_views: number;
  unique_visitors: number;
  total_saves: number;
  unique_savers: number;
  conversion_rate: number;
  comparison: {
    views_change: string;
    saves_change: string;
  };
}

export interface ViewsOverTime {
  date: string;
  views: number;
  unique: number;
}

export interface SavesOverTime {
  date: string;
  saves: number;
  unique: number;
}

export interface CountryData {
  country: string;
  code: string;
  views: number;
  unique: number;
}

export interface CityData {
  city: string;
  country: string;
  views: number;
  unique: number;
}

export interface MapData {
  lat: number;
  lng: number;
  count: number;
  city: string;
  country: string;
}

export interface RecentActivity {
  id: string;
  type: "profile_view" | "contact_save";
  description: string;
  timestamp: string;
  time_ago: string;
  location: string;
  device: string;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  charts: {
    views_over_time: ViewsOverTime[];
    saves_over_time: SavesOverTime[];
  };
  locations: {
    countries: CountryData[];
    cities: CityData[];
    map_data: MapData[];
  };
  recent_activities: {
    items: RecentActivity[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  };
  date_range: {
    filter: string;
    start: string;
    end: string;
  };
}

export interface AnalyticsResponse {
  error: string;
  success: boolean;
  data: AnalyticsData;
  meta: {
    generated_at: string;
    response_time_ms: number;
    cached: boolean;
    requester_ip: string;
  };
}