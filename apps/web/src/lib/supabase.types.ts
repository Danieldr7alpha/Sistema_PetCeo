export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          company_id: string | null;
          name: string;
          role: "ADMIN" | "EMPLOYEE";
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          company_id?: string | null;
          name: string;
          role?: "ADMIN" | "EMPLOYEE";
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string | null;
          name?: string;
          role?: "ADMIN" | "EMPLOYEE";
          active?: boolean;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
