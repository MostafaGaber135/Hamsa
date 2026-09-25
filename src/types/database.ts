// Same shape as `npx supabase gen types typescript`. Once your project is linked,
// regenerate this file instead of editing it by hand:
//   npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12'
  }
  public: {
    Tables: {
      friendships: {
        Row: {
          id: string
          requester_id: string
          addressee_id: string
          status: string
          created_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          requester_id: string
          addressee_id: string
          status?: string
          created_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          requester_id?: string
          addressee_id?: string
          status?: string
          created_at?: string
          responded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'friendships_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'friendships_addressee_id_fkey'
            columns: ['addressee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          username: string
          full_name: string
          avatar_url: string | null
          last_seen_at: string
          created_at: string
          group_invites: string
        }
        Insert: {
          id: string
          username: string
          full_name: string
          avatar_url?: string | null
          last_seen_at?: string
          created_at?: string
          group_invites?: string
        }
        Update: {
          id?: string
          username?: string
          full_name?: string
          avatar_url?: string | null
          last_seen_at?: string
          created_at?: string
          group_invites?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          is_group: boolean
          name: string | null
          created_by: string | null
          created_at: string
          last_message_at: string | null
          direct_key: string | null
        }
        Insert: {
          id?: string
          is_group?: boolean
          name?: string | null
          created_by?: string | null
          created_at?: string
          last_message_at?: string | null
          direct_key?: string | null
        }
        Update: {
          id?: string
          is_group?: boolean
          name?: string | null
          created_by?: string | null
          created_at?: string
          last_message_at?: string | null
          direct_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'conversations_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          user_id: string
          role: string
          muted: boolean
          last_read_at: string
          joined_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          role?: string
          muted?: boolean
          last_read_at?: string
          joined_at?: string
        }
        Update: {
          conversation_id?: string
          user_id?: string
          role?: string
          muted?: boolean
          last_read_at?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_participants_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversation_participants_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          content: string | null
          image_path: string | null
          created_at: string
          kind: string
          attachment: Json | null
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id?: string
          content?: string | null
          image_path?: string | null
          created_at?: string
          kind?: string
          attachment?: Json | null
        }
        Update: {
          id?: string
          conversation_id?: string
          sender_id?: string
          content?: string | null
          image_path?: string | null
          created_at?: string
          kind?: string
          attachment?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      create_group_conversation: {
        Args: { group_name: string; member_ids: string[] }
        Returns: string
      }
      get_my_conversations: {
        Args: never
        Returns: {
          id: string
          is_group: boolean
          name: string | null
          created_at: string
          last_message_at: string | null
          muted: boolean
          last_read_at: string
          unread_count: number
          members: Json
          last_message: Json
          pinned_at: string | null
          marked_unread: boolean
          cleared_at: string | null
          avatar_url: string | null
          wallpaper: string | null
          my_role: string
        }[]
      }
      get_my_friendships: {
        Args: never
        Returns: {
          user_id: string
          username: string
          full_name: string
          avatar_url: string | null
          status: string
          direction: string
          created_at: string
        }[]
      }
      get_or_create_direct_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      is_member: {
        Args: { conv_id: string }
        Returns: boolean
      }
      is_member_of_path: {
        Args: { object_name: string }
        Returns: boolean
      }
      add_group_members: {
        Args: { conv_id: string; member_ids: string[] }
        Returns: undefined
      }
      remove_group_member: {
        Args: { conv_id: string; member_id: string }
        Returns: undefined
      }
      set_conversation_wallpaper: {
        Args: { conv_id: string; new_wallpaper: string }
        Returns: undefined
      }
      set_member_role: {
        Args: { conv_id: string; member_id: string; new_role: string }
        Returns: undefined
      }
      update_group: {
        Args: { conv_id: string; new_name: string; new_avatar_url: string | null }
        Returns: undefined
      }
      clear_conversation: {
        Args: { conv_id: string }
        Returns: undefined
      }
      leave_conversation: {
        Args: { conv_id: string }
        Returns: undefined
      }
      mark_conversation_unread: {
        Args: { conv_id: string }
        Returns: undefined
      }
      save_push_subscription: {
        Args: { sub_endpoint: string; sub_p256dh: string; sub_auth: string; sub_user_agent: string }
        Returns: undefined
      }
      block_user: {
        Args: { target_id: string }
        Returns: undefined
      }
      unblock_user: {
        Args: { target_id: string }
        Returns: undefined
      }
      get_my_blocks: {
        Args: never
        Returns: {
          user_id: string
          username: string
          full_name: string
          avatar_url: string | null
          created_at: string
        }[]
      }
      get_blocked_conversations: {
        Args: never
        Returns: string[]
      }
      delete_push_subscription: {
        Args: { sub_endpoint: string }
        Returns: undefined
      }
      touch_last_seen: {
        Args: never
        Returns: undefined
      }
      set_conversation_muted: {
        Args: { conv_id: string; is_muted: boolean }
        Returns: undefined
      }
      set_conversation_pinned: {
        Args: { conv_id: string; pinned: boolean }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { conv_id: string }
        Returns: undefined
      }
      remove_friendship: {
        Args: { other_user_id: string }
        Returns: undefined
      }
      respond_friend_request: {
        Args: { requester: string; accept: boolean }
        Returns: undefined
      }
      send_friend_request: {
        Args: { target_id: string }
        Returns: string
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
