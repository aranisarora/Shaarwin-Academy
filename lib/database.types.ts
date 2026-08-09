// Generated from the live Postgres schema — DO NOT EDIT BY HAND.
//
// ...with two exceptions, so regenerate by DIFFING, never by overwriting:
// `npm run db:reset && supabase gen types typescript --local`, then port the
// delta. The generator emits a `graphql_public` schema this file drops, and it
// does NOT emit the PostgREST computed fields under `classes` (location_label
// and friends, migration 0052) — those are maintained by hand below.
//
// Commit it in the same commit as the migration + supabase/schema.sql.
// See AGENTS.md → Database.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      area_interest: {
        Row: {
          created_at: string
          email: string
          id: string
          lat: number | null
          lng: number | null
          postcode: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          lat?: number | null
          lng?: number | null
          postcode: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          lat?: number | null
          lng?: number | null
          postcode?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          meta: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          meta?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          meta?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_series: {
        Row: {
          active: boolean
          cancelled_at: string | null
          class_id: string
          client_id: string | null
          created_at: string
          id: string
          player_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          active?: boolean
          cancelled_at?: string | null
          class_id: string
          client_id?: string | null
          created_at?: string
          id?: string
          player_id: string
          start_time: string
          weekday: number
        }
        Update: {
          active?: boolean
          cancelled_at?: string | null
          class_id?: string
          client_id?: string | null
          created_at?: string
          id?: string
          player_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_series_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booked_at: string
          cancel_reason: string | null
          cancelled_at: string | null
          client_id: string | null
          coach_note: string | null
          id: string
          player_id: string
          private_series_id: string | null
          rescheduled_from: string | null
          series_id: string | null
          session_id: string
          status: Database["public"]["Enums"]["booking_status"]
          waitlist_position: number | null
        }
        Insert: {
          booked_at?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          coach_note?: string | null
          id?: string
          player_id: string
          private_series_id?: string | null
          rescheduled_from?: string | null
          series_id?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["booking_status"]
          waitlist_position?: number | null
        }
        Update: {
          booked_at?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          coach_note?: string | null
          id?: string
          player_id?: string
          private_series_id?: string | null
          rescheduled_from?: string | null
          series_id?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_private_series_id_fkey"
            columns: ["private_series_id"]
            isOneToOne: false
            referencedRelation: "private_booking_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "booking_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      class_credits: {
        Row: {
          booking_id: string | null
          client_id: string
          consumed_at: string | null
          created_at: string
          id: string
          note: string | null
          order_id: string | null
          player_id: string | null
          source: Database["public"]["Enums"]["class_credit_source"]
          type: Database["public"]["Enums"]["class_credit_type"]
        }
        Insert: {
          booking_id?: string | null
          client_id: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          player_id?: string | null
          source?: Database["public"]["Enums"]["class_credit_source"]
          type: Database["public"]["Enums"]["class_credit_type"]
        }
        Update: {
          booking_id?: string | null
          client_id?: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          player_id?: string | null
          source?: Database["public"]["Enums"]["class_credit_source"]
          type?: Database["public"]["Enums"]["class_credit_type"]
        }
        Relationships: [
          {
            foreignKeyName: "class_credits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_credits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_credits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_credits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_credits_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      class_sessions: {
        Row: {
          cancel_reason: string | null
          capacity_override: number | null
          class_id: string
          coach_arrival_distance_m: number | null
          coach_arrival_source: string | null
          coach_arrived_at: string | null
          coach_confirmed_at: string | null
          coach_id: string | null
          coach_late_at: string | null
          coach_notes: string | null
          created_at: string
          ends_at: string
          id: string
          starts_at: string
          status: Database["public"]["Enums"]["session_status"]
        }
        Insert: {
          cancel_reason?: string | null
          capacity_override?: number | null
          class_id: string
          coach_arrival_distance_m?: number | null
          coach_arrival_source?: string | null
          coach_arrived_at?: string | null
          coach_confirmed_at?: string | null
          coach_id?: string | null
          coach_late_at?: string | null
          coach_notes?: string | null
          created_at?: string
          ends_at: string
          id?: string
          starts_at: string
          status?: Database["public"]["Enums"]["session_status"]
        }
        Update: {
          cancel_reason?: string | null
          capacity_override?: number | null
          class_id?: string
          coach_arrival_distance_m?: number | null
          coach_arrival_source?: string | null
          coach_arrived_at?: string | null
          coach_confirmed_at?: string | null
          coach_id?: string | null
          coach_late_at?: string | null
          coach_notes?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["session_status"]
        }
        Relationships: [
          {
            foreignKeyName: "class_sessions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_sessions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          active: boolean
          capacity: number
          class_type: Database["public"]["Enums"]["class_type"]
          created_at: string
          created_by: string | null
          description: string | null
          duration_minutes: number
          ends_on: string | null
          id: string
          is_school: boolean
          recurrence_rule: string | null
          skill_level: Database["public"]["Enums"]["skill_level"]
          starts_on: string
          timezone: string
          title: string
          venue_id: string | null
          // Computed fields (PostgREST exposes any function taking a `classes`
          // row as a selectable column). `supabase gen types` does not emit
          // these, so they are maintained by hand — see migration 0052.
          location_label: string | null
          location_venue: string | null
          location_unit: string | null
          location_maps_url: string | null
        }
        Insert: {
          active?: boolean
          capacity?: number
          class_type: Database["public"]["Enums"]["class_type"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes: number
          ends_on?: string | null
          id?: string
          is_school?: boolean
          recurrence_rule?: string | null
          skill_level?: Database["public"]["Enums"]["skill_level"]
          starts_on: string
          timezone?: string
          title: string
          venue_id?: string | null
        }
        Update: {
          active?: boolean
          capacity?: number
          class_type?: Database["public"]["Enums"]["class_type"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          ends_on?: string | null
          id?: string
          is_school?: boolean
          recurrence_rule?: string | null
          skill_level?: Database["public"]["Enums"]["skill_level"]
          starts_on?: string
          timezone?: string
          title?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invites: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string | null
          full_name: string | null
          id: string
          notes: string | null
          phone: string
          plan_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone: string
          plan_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone?: string
          plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_assignments: {
        Row: {
          assigned_by: string | null
          coach_id: string
          created_at: string
          id: string
          locked: boolean
          score: number | null
          session_id: string
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_by?: string | null
          coach_id: string
          created_at?: string
          id?: string
          locked?: boolean
          score?: number | null
          session_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_by?: string | null
          coach_id?: string
          created_at?: string
          id?: string
          locked?: boolean
          score?: number | null
          session_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "coach_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assignments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_availability: {
        Row: {
          coach_id: string
          end_time: string
          id: string
          start_time: string
          weekday: number
        }
        Insert: {
          coach_id: string
          end_time: string
          id?: string
          start_time: string
          weekday: number
        }
        Update: {
          coach_id?: string
          end_time?: string
          id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_availability_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_invites: {
        Row: {
          base_address: string | null
          base_lat: number | null
          base_lng: number | null
          bio: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string | null
          dbs_checked: boolean
          email: string
          full_name: string | null
          id: string
          max_teachable_level: Database["public"]["Enums"]["skill_level"]
          phone: string | null
        }
        Insert: {
          base_address?: string | null
          base_lat?: number | null
          base_lng?: number | null
          bio?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          dbs_checked?: boolean
          email: string
          full_name?: string | null
          id?: string
          max_teachable_level?: Database["public"]["Enums"]["skill_level"]
          phone?: string | null
        }
        Update: {
          base_address?: string | null
          base_lat?: number | null
          base_lng?: number | null
          bio?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          dbs_checked?: boolean
          email?: string
          full_name?: string | null
          id?: string
          max_teachable_level?: Database["public"]["Enums"]["skill_level"]
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_time_off: {
        Row: {
          coach_id: string
          created_at: string
          decided_by: string | null
          ends_at: string
          id: string
          reason: string | null
          starts_at: string
          status: Database["public"]["Enums"]["time_off_status"]
        }
        Insert: {
          coach_id: string
          created_at?: string
          decided_by?: string | null
          ends_at: string
          id?: string
          reason?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["time_off_status"]
        }
        Update: {
          coach_id?: string
          created_at?: string
          decided_by?: string | null
          ends_at?: string
          id?: string
          reason?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["time_off_status"]
        }
        Relationships: [
          {
            foreignKeyName: "coach_time_off_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_time_off_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_time_off_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coaches: {
        Row: {
          active: boolean
          base_address: string | null
          base_lat: number
          base_lng: number
          bio: string | null
          created_at: string
          credentials: string[]
          dbs_checked: boolean
          id: string
          max_teachable_level: Database["public"]["Enums"]["skill_level"]
          photo_url: string | null
          quote: string | null
        }
        Insert: {
          active?: boolean
          base_address?: string | null
          base_lat: number
          base_lng: number
          bio?: string | null
          created_at?: string
          credentials?: string[]
          dbs_checked?: boolean
          id: string
          max_teachable_level?: Database["public"]["Enums"]["skill_level"]
          photo_url?: string | null
          quote?: string | null
        }
        Update: {
          active?: boolean
          base_address?: string | null
          base_lat?: number
          base_lng?: number
          bio?: string | null
          created_at?: string
          credentials?: string[]
          dbs_checked?: boolean
          id?: string
          max_teachable_level?: Database["public"]["Enums"]["skill_level"]
          photo_url?: string | null
          quote?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coaches_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaches_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_pence: number
          client_id: string
          created_at: string
          currency: string
          hosted_invoice_url: string | null
          id: string
          paid_at: string | null
          razorpay_payment_id: string | null
          status: string
          stripe_invoice_id: string | null
          subscription_id: string | null
        }
        Insert: {
          amount_pence: number
          client_id: string
          created_at?: string
          currency?: string
          hosted_invoice_url?: string | null
          id?: string
          paid_at?: string | null
          razorpay_payment_id?: string | null
          status: string
          stripe_invoice_id?: string | null
          subscription_id?: string | null
        }
        Update: {
          amount_pence?: number
          client_id?: string
          created_at?: string
          currency?: string
          hosted_invoice_url?: string | null
          id?: string
          paid_at?: string | null
          razorpay_payment_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          channel_attempted: string | null
          created_at: string
          data: Json
          error: string | null
          id: string
          read_at: string | null
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          title: string
          type: string
          user_id: string
          whatsapp_status: string | null
        }
        Insert: {
          body: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          channel_attempted?: string | null
          created_at?: string
          data?: Json
          error?: string | null
          id?: string
          read_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title: string
          type: string
          user_id: string
          whatsapp_status?: string | null
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          channel_attempted?: string | null
          created_at?: string
          data?: Json
          error?: string | null
          id?: string
          read_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title?: string
          type?: string
          user_id?: string
          whatsapp_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_pence: number
          client_id: string
          created_at: string
          currency: string
          id: string
          paid_at: string | null
          player_id: string | null
          product_id: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          status: string
        }
        Insert: {
          amount_pence: number
          client_id: string
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          player_id?: string | null
          product_id: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
        }
        Update: {
          amount_pence?: number
          client_id?: string
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          player_id?: string | null
          product_id?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          billing_interval_months: number
          created_at: string
          currency: string
          description: string | null
          group_sessions_per_week: number | null
          id: string
          name: string
          price_pence: number
          private_minutes_per_cycle: number
          private_session_minutes: number | null
          private_sessions_per_week: number | null
          razorpay_plan_id: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
        }
        Insert: {
          active?: boolean
          billing_interval_months?: number
          created_at?: string
          currency?: string
          description?: string | null
          group_sessions_per_week?: number | null
          id?: string
          name: string
          price_pence: number
          private_minutes_per_cycle?: number
          private_session_minutes?: number | null
          private_sessions_per_week?: number | null
          razorpay_plan_id?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
        }
        Update: {
          active?: boolean
          billing_interval_months?: number
          created_at?: string
          currency?: string
          description?: string | null
          group_sessions_per_week?: number | null
          id?: string
          name?: string
          price_pence?: number
          private_minutes_per_cycle?: number
          private_session_minutes?: number | null
          private_sessions_per_week?: number | null
          razorpay_plan_id?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
        }
        Relationships: []
      }
      players: {
        Row: {
          client_id: string | null
          created_at: string
          date_of_birth: string | null
          full_name: string
          grade: number | null
          id: string
          notes: string | null
          school_venue_id: string | null
          skill_level: Database["public"]["Enums"]["skill_level"]
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name: string
          grade?: number | null
          id?: string
          notes?: string | null
          school_venue_id?: string | null
          skill_level?: Database["public"]["Enums"]["skill_level"]
        }
        Update: {
          client_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name?: string
          grade?: number | null
          id?: string
          notes?: string | null
          school_venue_id?: string | null
          skill_level?: Database["public"]["Enums"]["skill_level"]
        }
        Relationships: [
          {
            foreignKeyName: "players_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_school_venue_id_fkey"
            columns: ["school_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_series: {
        Row: {
          access_notes: string | null
          active: boolean
          address: string
          address_details: Json | null
          cancelled_at: string | null
          client_id: string
          created_at: string
          duration_minutes: number
          has_table: boolean
          id: string
          lat: number
          lng: number
          player_id: string
          postcode: string
          preferred_coach: string | null
          start_time: string
          weekday: number
          venue_id: string | null
          venue_label: string | null
          unit_label: string | null
        }
        Insert: {
          access_notes?: string | null
          active?: boolean
          address: string
          address_details?: Json | null
          cancelled_at?: string | null
          client_id: string
          created_at?: string
          duration_minutes: number
          has_table?: boolean
          id?: string
          lat: number
          lng: number
          player_id: string
          postcode?: string
          preferred_coach?: string | null
          start_time: string
          weekday: number
          venue_id?: string | null
          venue_label?: string | null
          unit_label?: string | null
        }
        Update: {
          access_notes?: string | null
          active?: boolean
          address?: string
          address_details?: Json | null
          cancelled_at?: string | null
          client_id?: string
          created_at?: string
          duration_minutes?: number
          has_table?: boolean
          id?: string
          lat?: number
          lng?: number
          player_id?: string
          postcode?: string
          preferred_coach?: string | null
          start_time?: string
          weekday?: number
          venue_id?: string | null
          venue_label?: string | null
          unit_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_series_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_series_preferred_coach_fkey"
            columns: ["preferred_coach"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      private_class_details: {
        Row: {
          access_notes: string | null
          address: string
          address_details: Json | null
          class_id: string
          client_id: string | null
          has_table: boolean
          lat: number
          lng: number
          player_id: string | null
          postcode: string
          venue_label: string | null
          unit_label: string | null
        }
        Insert: {
          access_notes?: string | null
          address: string
          address_details?: Json | null
          class_id: string
          client_id?: string | null
          has_table?: boolean
          lat: number
          lng: number
          player_id?: string | null
          postcode: string
          venue_label?: string | null
          unit_label?: string | null
        }
        Update: {
          access_notes?: string | null
          address?: string
          address_details?: Json | null
          class_id?: string
          client_id?: string | null
          has_table?: boolean
          lat?: number
          lng?: number
          player_id?: string | null
          postcode?: string
          venue_label?: string | null
          unit_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_class_details_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: true
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_class_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_class_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_class_details_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      private_credit_ledger: {
        Row: {
          booking_id: string | null
          client_id: string
          created_at: string
          delta_minutes: number
          id: string
          note: string | null
          reason: Database["public"]["Enums"]["credit_reason"]
          subscription_id: string | null
        }
        Insert: {
          booking_id?: string | null
          client_id: string
          created_at?: string
          delta_minutes: number
          id?: string
          note?: string | null
          reason: Database["public"]["Enums"]["credit_reason"]
          subscription_id?: string | null
        }
        Update: {
          booking_id?: string | null
          client_id?: string
          created_at?: string
          delta_minutes?: number
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["credit_reason"]
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_credit_ledger_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_credit_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_credit_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_credit_ledger_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          duration_minutes: number | null
          grants_minutes: number
          id: string
          kind: Database["public"]["Enums"]["product_kind"]
          member_price_pence: number | null
          name: string
          price_pence: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          grants_minutes?: number
          id: string
          kind: Database["public"]["Enums"]["product_kind"]
          member_price_pence?: number | null
          name: string
          price_pence: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          grants_minutes?: number
          id?: string
          kind?: Database["public"]["Enums"]["product_kind"]
          member_price_pence?: number | null
          name?: string
          price_pence?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_details: Json | null
          approval_status: Database["public"]["Enums"]["signup_approval_status"]
          avatar_url: string | null
          created_at: string
          default_address: string | null
          default_lat: number | null
          default_lng: number | null
          deleted_at: string | null
          disputed: boolean
          email: string
          full_name: string
          id: string
          notification_prefs: Json
          onboarded_at: string | null
          onboarding_step: number
          phone: string | null
          razorpay_customer_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          stripe_customer_id: string | null
          wa_muted: boolean
        }
        Insert: {
          address_details?: Json | null
          approval_status?: Database["public"]["Enums"]["signup_approval_status"]
          avatar_url?: string | null
          created_at?: string
          default_address?: string | null
          default_lat?: number | null
          default_lng?: number | null
          deleted_at?: string | null
          disputed?: boolean
          email: string
          full_name: string
          id: string
          notification_prefs?: Json
          onboarded_at?: string | null
          onboarding_step?: number
          phone?: string | null
          razorpay_customer_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          stripe_customer_id?: string | null
          wa_muted?: boolean
        }
        Update: {
          address_details?: Json | null
          approval_status?: Database["public"]["Enums"]["signup_approval_status"]
          avatar_url?: string | null
          created_at?: string
          default_address?: string | null
          default_lat?: number | null
          default_lng?: number | null
          deleted_at?: string | null
          disputed?: boolean
          email?: string
          full_name?: string
          id?: string
          notification_prefs?: Json
          onboarded_at?: string | null
          onboarding_step?: number
          phone?: string | null
          razorpay_customer_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          stripe_customer_id?: string | null
          wa_muted?: boolean
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      school_admins: {
        Row: {
          created_at: string
          created_by: string | null
          password_secret_id: string | null
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          password_secret_id?: string | null
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          password_secret_id?: string | null
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_admins_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_admins_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_assessments: {
        Row: {
          coach_id: string
          created_at: string
          id: string
          player_id: string
          session_id: string | null
        }
        Insert: {
          coach_id: string
          created_at?: string
          id?: string
          player_id: string
          session_id?: string | null
        }
        Update: {
          coach_id?: string
          created_at?: string
          id?: string
          player_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skill_assessments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_assessments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_assessments_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_assessments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      skill_ratings: {
        Row: {
          assessment_id: string
          id: string
          rating: number
          skill_id: string
        }
        Insert: {
          assessment_id: string
          id?: string
          rating: number
          skill_id: string
        }
        Update: {
          assessment_id?: string
          id?: string
          rating?: number
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_ratings_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "skill_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_ratings_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "skills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "skill_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          player_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          player_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_notes_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          client_id: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_id: string
          razorpay_subscription_id: string | null
          source: Database["public"]["Enums"]["subscription_source"]
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          client_id: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id: string
          razorpay_subscription_id?: string | null
          source?: Database["public"]["Enums"]["subscription_source"]
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          client_id?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id?: string
          razorpay_subscription_id?: string | null
          source?: Database["public"]["Enums"]["subscription_source"]
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          active: boolean
          address: string
          address_details: Json | null
          created_at: string
          id: string
          is_school: boolean
          lat: number
          lng: number
          name: string
          unit: string | null
          notes: string | null
          photo_url: string | null
          postcode: string
        }
        Insert: {
          active?: boolean
          address: string
          address_details?: Json | null
          created_at?: string
          id?: string
          is_school?: boolean
          lat: number
          lng: number
          name: string
          unit?: string | null
          notes?: string | null
          photo_url?: string | null
          postcode: string
        }
        Update: {
          active?: boolean
          address?: string
          address_details?: Json | null
          created_at?: string
          id?: string
          is_school?: boolean
          lat?: number
          lng?: number
          name?: string
          unit?: string | null
          notes?: string | null
          photo_url?: string | null
          postcode?: string
        }
        Relationships: []
      }
      wa_inbound_seen: {
        Row: {
          created_at: string
          message_sid: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          message_sid: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          message_sid?: string
          phone?: string | null
        }
        Relationships: []
      }
      wa_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          phone: string
          role: string
          seq: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          phone: string
          role: string
          seq?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          phone?: string
          role?: string
          seq?: number
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          payload: Json
          processed_at: string | null
          stripe_event_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          payload: Json
          processed_at?: string | null
          stripe_event_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          stripe_event_id?: string | null
          type?: string
        }
        Relationships: []
      }
    }
    Views: {
      coach_client_view: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
      latest_skill_ratings: {
        Row: {
          coach_id: string | null
          created_at: string | null
          player_id: string | null
          rating: number | null
          skill_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skill_assessments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_assessments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_assessments_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_ratings_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _assert_private_plan_allows: {
        Args: { p_client: string; p_duration: number; p_start: string }
        Returns: undefined
      }
      _book_one: {
        Args: {
          p_client: string
          p_notify?: boolean
          p_player: string
          p_series?: string
          p_session: string
        }
        Returns: string
      }
      _consume_group_credit: {
        Args: { p_client: string; p_player: string }
        Returns: string
      }
      _create_private_occurrence: {
        Args: {
          p_access_notes: string
          p_address: string
          p_address_details: Json
          p_client: string
          p_duration: number
          p_has_table: boolean
          p_lat: number
          p_lng: number
          p_notify?: boolean
          p_player: string
          p_postcode: string
          p_preferred?: string
          p_series?: string
          p_start: string
        }
        Returns: string
      }
      _session_alert_text: {
        Args: {
          p_base_body: string
          p_base_title: string
          p_sessions: Json
          p_summary_fmt: string
        }
        Returns: Json
      }
      add_school_player: {
        Args: { p_full_name: string; p_grade: number; p_session: string }
        Returns: string
      }
      alert_founders_session: {
        Args: {
          p_body: string
          p_session: string
          p_summary_fmt?: string
          p_title: string
          p_type: string
          p_url: string
        }
        Returns: undefined
      }
      assign_coach: {
        Args: { p_preferred?: string; p_session: string }
        Returns: string
      }
      assign_unassigned_sessions: { Args: never; Returns: number }
      book_series: {
        Args: { p_player: string; p_recurring?: boolean; p_session: string }
        Returns: Json
      }
      book_session: {
        Args: { p_player: string; p_session: string }
        Returns: {
          booked_at: string
          cancel_reason: string | null
          cancelled_at: string | null
          client_id: string | null
          coach_note: string | null
          id: string
          player_id: string
          private_series_id: string | null
          rescheduled_from: string | null
          series_id: string | null
          session_id: string
          status: Database["public"]["Enums"]["booking_status"]
          waitlist_position: number | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_booking: { Args: { p_booking: string }; Returns: undefined }
      cancel_private_series: { Args: { p_series: string }; Returns: number }
      cancel_series: { Args: { p_series: string }; Returns: number }
      claim_coach_invite_by_phone: {
        Args: { p_phone: string; p_user: string }
        Returns: boolean
      }
      claim_cover_session: { Args: { p_session: string }; Returns: undefined }
      claim_waitlist_spot: { Args: { p_booking: string }; Returns: string }
      class_is_public_group: { Args: { p_class: string }; Returns: boolean }
      class_location_label: { Args: { p_class: string }; Returns: string }
      class_location_maps_url: { Args: { p_class: string }; Returns: string }
      client_owns_private_class: { Args: { p_class: string }; Returns: boolean }
      coach_confirm_session: { Args: { p_session: string }; Returns: string }
      coach_filter_failure: {
        Args: { p_coach: string; p_session: string }
        Returns: string
      }
      coach_has_client: { Args: { p_client: string }; Returns: boolean }
      coach_has_player: { Args: { p_player: string }; Returns: boolean }
      coach_mark_arrival: {
        Args: {
          p_distance_m?: number
          p_late?: boolean
          p_session: string
          p_source?: string
        }
        Returns: string
      }
      coach_teaches_class: { Args: { p_class: string }; Returns: boolean }
      coach_undo_arrival: { Args: { p_session: string }; Returns: undefined }
      create_private_series: { Args: { payload: Json }; Returns: Json }
      end_private_series_as_academy: { Args: { p_series: string }; Returns: Json }
      expire_credits: { Args: never; Returns: undefined }
      fmt_inr: { Args: { p_paise: number }; Returns: string }
      fmt_ist: { Args: { ts: string }; Returns: string }
      founder_reassign: {
        Args: {
          p_coach: string
          p_force?: boolean
          p_lock?: boolean
          p_session: string
        }
        Returns: undefined
      }
      generate_class_sessions: { Args: { p_weeks?: number }; Returns: number }
      generate_private_sessions: { Args: { p_weeks?: number }; Returns: number }
      get_bookable_slots: {
        Args: {
          p_days?: number
          p_duration: number
          p_lat: number
          p_lng: number
          p_player: string
        }
        Returns: {
          coach_count: number
          starts_at: string
        }[]
      }
      get_pending_assessments: {
        Args: { p_coach?: string }
        Returns: {
          class_title: string
          player_id: string
          player_name: string
          session_ended_at: string
          session_id: string
        }[]
      }
      get_player_notes: {
        Args: { p_player: string }
        Returns: {
          author_name: string
          body: string
          created_at: string
          id: string
        }[]
      }
      get_players_mastery: {
        Args: { p_players: string[] }
        Returns: {
          mastery: number
          player_id: string
        }[]
      }
      get_setting_int: {
        Args: { p_default: number; p_key: string }
        Returns: number
      }
      handle_coach_dropout: {
        Args: { p_coach: string; p_from: string; p_to: string }
        Returns: undefined
      }
      has_active_subscription: { Args: { p_client: string }; Returns: boolean }
      has_group_subscription: { Args: { p_client: string }; Returns: boolean }
      haversine_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_approved: { Args: never; Returns: boolean }
      is_coach: { Args: never; Returns: boolean }
      is_founder: { Args: never; Returns: boolean }
      is_school_admin: { Args: never; Returns: boolean }
      school_admin_class: { Args: { p_class: string }; Returns: boolean }
      school_admin_session: { Args: { p_session: string }; Returns: boolean }
      school_admin_venues: { Args: never; Returns: string[] }
      school_has_player: { Args: { p_player: string }; Returns: boolean }
      set_school_password: {
        Args: { p_user: string; p_password: string }
        Returns: undefined
      }
      school_password: { Args: { p_user: string }; Returns: string | null }
      clear_school_password: { Args: { p_user: string }; Returns: undefined }
      school_last_sign_in: {
        Args: never
        Returns: { school_user_id: string; signed_in_at: string | null }[]
      }
      location_label: {
        Args: { c: Database["public"]["Tables"]["classes"]["Row"] }
        Returns: string
      }
      location_venue: {
        Args: { c: Database["public"]["Tables"]["classes"]["Row"] }
        Returns: string
      }
      location_unit: {
        Args: { c: Database["public"]["Tables"]["classes"]["Row"] }
        Returns: string
      }
      location_maps_url: {
        Args: { c: Database["public"]["Tables"]["classes"]["Row"] }
        Returns: string
      }
      venue_display: {
        Args: { v: Database["public"]["Tables"]["venues"]["Row"] }
        Returns: string
      }
      notify_founders: {
        Args: { p_body: string; p_data?: Json; p_title: string; p_type: string }
        Returns: undefined
      }
      offer_cover_session: { Args: { p_session: string }; Returns: number }
      private_minutes_balance: { Args: { p_client: string }; Returns: number }
      private_plan_limits: {
        Args: { p_client: string }
        Returns: {
          session_minutes: number
          sessions_per_week: number
        }[]
      }
      prune_wa_inbound_seen: { Args: never; Returns: undefined }
      purge_pending_session_reminders: {
        Args: { p_class_ids: string[] }
        Returns: number
      }
      public_coach_roster: {
        Args: never
        Returns: {
          base_lat: number
          base_lng: number
          bio: string
          credentials: string[]
          full_name: string
          id: string
          photo_url: string
          quote: string
        }[]
      }
      queue_coach_changed: {
        Args: {
          p_body: string
          p_session: string
          p_title: string
          p_url: string
          p_user: string
        }
        Returns: undefined
      }
      queue_session_alert: {
        Args: {
          p_body: string
          p_session: string
          p_summary_fmt?: string
          p_title: string
          p_type: string
          p_url: string
          p_user: string
        }
        Returns: undefined
      }
      rank_coaches: {
        Args: { p_preferred?: string; p_session: string }
        Returns: {
          coach_id: string
          score: number
        }[]
      }
      request_private_class: { Args: { payload: Json }; Returns: string }
      reschedule_booking: {
        Args: { p_booking: string; p_target_session: string }
        Returns: {
          booked_at: string
          cancel_reason: string | null
          cancelled_at: string | null
          client_id: string | null
          coach_note: string | null
          id: string
          player_id: string
          private_series_id: string | null
          rescheduled_from: string | null
          series_id: string | null
          session_id: string
          status: Database["public"]["Enums"]["booking_status"]
          waitlist_position: number | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reschedule_private_session: {
        Args: { p_confirm?: boolean; p_new_start: string; p_session: string }
        Returns: {
          coach_changed: boolean
          proposed_coach: string
        }[]
      }
      reschedule_series: {
        Args: { p_booking: string; p_target_session: string }
        Returns: Json
      }
      resolve_session_alert: { Args: { p_session: string }; Returns: undefined }
      review_signup_request: {
        Args: { p_approve: boolean; p_client: string; p_reviewer?: string }
        Returns: Json
      }
      submit_signup_request: {
        Args: { p_name: string; p_phone: string }
        Returns: Json
      }
      sweep_session_status: { Args: never; Returns: undefined }
      wipe_calendar: {
        Args: {
          p_confirm?: string
          p_keep_history?: boolean
          p_scope?: string
        }
        Returns: Json
      }
    }
    Enums: {
      assignment_status: "active" | "superseded"
      booking_status:
        | "confirmed"
        | "waitlisted"
        | "attended"
        | "no_show"
        | "rescheduled"
        | "cancelled_by_client"
        | "cancelled_by_academy"
      class_credit_source: "signup" | "purchase" | "manual"
      class_credit_type: "group_trial" | "group_dropin"
      class_type: "private" | "group"
      credit_reason:
        | "grant"
        | "booking"
        | "cancellation_refund"
        | "refund_adjustment"
        | "expiry"
        | "manual"
      notification_channel: "push" | "email" | "in_app"
      notification_status: "pending" | "sent" | "failed"
      product_kind: "group_dropin" | "private_oneoff" | "private_intro"
      session_status: "scheduled" | "completed" | "cancelled"
      signup_approval_status: "pending" | "approved" | "denied"
      skill_level: "beginner" | "intermediate" | "advanced" | "elite" | "any"
      subscription_source: "stripe" | "comp" | "razorpay"
      subscription_status:
        | "incomplete"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "paused"
      time_off_status: "pending" | "approved" | "rejected"
      user_role: "client" | "coach" | "founder" | "school"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      assignment_status: ["active", "superseded"],
      booking_status: [
        "confirmed",
        "waitlisted",
        "attended",
        "no_show",
        "rescheduled",
        "cancelled_by_client",
        "cancelled_by_academy",
      ],
      class_credit_source: ["signup", "purchase", "manual"],
      class_credit_type: ["group_trial", "group_dropin"],
      class_type: ["private", "group"],
      credit_reason: [
        "grant",
        "booking",
        "cancellation_refund",
        "refund_adjustment",
        "expiry",
        "manual",
      ],
      notification_channel: ["push", "email", "in_app"],
      notification_status: ["pending", "sent", "failed"],
      product_kind: ["group_dropin", "private_oneoff", "private_intro"],
      session_status: ["scheduled", "completed", "cancelled"],
      signup_approval_status: ["pending", "approved", "denied"],
      skill_level: ["beginner", "intermediate", "advanced", "elite", "any"],
      subscription_source: ["stripe", "comp", "razorpay"],
      subscription_status: [
        "incomplete",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "paused",
      ],
      time_off_status: ["pending", "approved", "rejected"],
      user_role: ["client", "coach", "founder", "school"],
    },
  },
} as const
