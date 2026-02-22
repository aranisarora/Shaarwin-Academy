export type UserRole = "client" | "coach" | "manager";
export type LocationType = "public" | "private";
export type ClassType = "group" | "private";
export type BookingStatus = "active" | "paused" | "cancelled";
export type DayCode = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

export interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  phone_number: string | null;
  role: UserRole;
  created_at: string;
}

export interface Coach {
  id: number;
  profile_id: string | null;
  bio: string | null;
  gcal_id: string;
  color_code: string;
  is_active: boolean;
}

export interface Location {
  id: number;
  name: string;
  address: string;
  type: LocationType;
  is_active: boolean;
}

export interface Batch {
  id: number;
  title: string;
  day_codes: DayCode[];
  start_time: string;
  end_time: string;
  location_id: number;
  default_coach_id: number | null;
  class_type: ClassType;
  max_capacity: number;
  is_active: boolean;
  location?: Location;
  coach?: Coach;
}

export interface Booking {
  id: number;
  user_id: string;
  batch_id: number;
  status: BookingStatus;
  start_date: string;
  end_date: string | null;
  created_at: string;
  batch?: Batch;
  profile?: Profile;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at"> & { created_at?: string };
        Update: Partial<Omit<Profile, "id" | "created_at">>;
      };
      coaches: {
        Row: Coach;
        Insert: Omit<Coach, "id">;
        Update: Partial<Omit<Coach, "id">>;
      };
      locations: {
        Row: Location;
        Insert: Omit<Location, "id">;
        Update: Partial<Omit<Location, "id">>;
      };
      batches: {
        Row: Batch;
        Insert: Omit<Batch, "id" | "location" | "coach">;
        Update: Partial<Omit<Batch, "id" | "location" | "coach">>;
      };
      bookings: {
        Row: Booking;
        Insert: Omit<Booking, "id" | "created_at" | "batch" | "profile"> & {
          created_at?: string;
        };
        Update: Partial<
          Omit<Booking, "id" | "created_at" | "batch" | "profile">
        >;
      };
    };
  };
}
