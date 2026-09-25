/**
 * Tipos do banco, espelhando `supabase/migrations/`.
 *
 * Mantidos à mão para o projeto não depender da CLI do Supabase nem de Docker.
 * Se alterar uma migração, atualize o tipo correspondente aqui — ou regenere
 * tudo com:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 *
 * O campo `Relationships` é exigido pelo `postgrest-js` para reconhecer o
 * schema (sem ele, todas as consultas caem para o tipo `never`). Fica vazio
 * porque a aplicação não usa embeds — perfis são resolvidos por mapa. Veja a
 * nota em `src/lib/queries.ts`.
 */

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type InvitationStatus = "pending" | "accepted" | "revoked";
export type NotificationType = "task_assigned" | "comment_added";

export type RecurrenceType =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "periodic"
  | "custom";

export type RecurrenceUnit = "day" | "week" | "month" | "year";

/** Coluna do quadro Kanban. Independente de `is_completed`, mas sincronizada
 *  com ela pela server action (`patchTaskAction`) — ver `src/lib/permissions.ts`
 *  e `src/app/actions/tasks.ts`. */
export type TaskBoardStatus = "todo" | "doing" | "done";

/** Tipo de um campo personalizado por espaço de trabalho. */
export type CustomFieldType = "text" | "number" | "date" | "select";

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/**
 * Definida fora de `Database` porque a view `task_overview` reutiliza estes
 * campos — referenciá-los por `Database["public"]["Tables"]["tasks"]` de dentro
 * da própria interface criaria um tipo circular.
 *
 * Precisa ser `type`, e não `interface`: o `postgrest-js` exige que cada Row
 * satisfaça `Record<string, unknown>`, e interfaces não ganham index signature
 * implícita — com `interface` aqui, todas as consultas a `tasks` viram `never`.
 */
export type TaskRow = {
  id: string;
  workspace_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  assignee_id: string | null;
  priority: TaskPriority;
  due_date: string | null;
  /** Hora de parede, "HH:MM:SS". Opcional e sempre acompanhada de `due_date`. */
  due_time: string | null;
  is_completed: boolean;
  completed_at: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  recurrence_type: RecurrenceType;
  recurrence_interval: number;
  recurrence_unit: RecurrenceUnit;
  /** 0 = domingo … 6 = sábado. */
  recurrence_weekdays: number[];
  recurrence_ends_on: string | null;
  /**
   * Tarefa que a pessoa criou para si. Continua pertencendo ao espaço onde
   * nasceu — o que muda é onde ela aparece: na lista pessoal, e não no
   * trabalho combinado do espaço.
   */
  is_personal: boolean;
  /** Coluna do quadro Kanban. Só tarefas de topo aparecem no quadro. */
  board_status: TaskBoardStatus;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          avatar_url?: string | null;
        };
        Update: {
          full_name?: string;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          description: string;
          color: string;
          owner_id: string;
          /** Membro designado; quando preenchido, só ele e quem administra veem as tarefas. */
          responsible_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string;
          color?: string;
          owner_id: string;
        };
        Update: {
          name?: string;
          description?: string;
          color?: string;
          responsible_id?: string | null;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: WorkspaceRole;
        };
        Update: {
          role?: WorkspaceRole;
        };
        Relationships: [];
      };
      tasks: {
        Row: TaskRow;
        Insert: {
          id?: string;
          workspace_id: string;
          parent_task_id?: string | null;
          title: string;
          description?: string;
          assignee_id?: string | null;
          priority?: TaskPriority;
          due_date?: string | null;
          due_time?: string | null;
          is_completed?: boolean;
          position?: number;
          created_by?: string | null;
          is_personal?: boolean;
          recurrence_type?: RecurrenceType;
          recurrence_interval?: number;
          recurrence_unit?: RecurrenceUnit;
          recurrence_weekdays?: number[];
          recurrence_ends_on?: string | null;
          board_status?: TaskBoardStatus;
        };
        Update: {
          title?: string;
          description?: string;
          assignee_id?: string | null;
          priority?: TaskPriority;
          due_date?: string | null;
          due_time?: string | null;
          is_completed?: boolean;
          position?: number;
          recurrence_type?: RecurrenceType;
          recurrence_interval?: number;
          recurrence_unit?: RecurrenceUnit;
          recurrence_weekdays?: number[];
          recurrence_ends_on?: string | null;
          board_status?: TaskBoardStatus;
        };
        Relationships: [];
      };
      task_dependencies: {
        Row: {
          workspace_id: string;
          task_id: string;
          depends_on_task_id: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          workspace_id: string;
          task_id: string;
          depends_on_task_id: string;
          created_by?: string | null;
        };
        // Sem UPDATE: uma dependência é criada ou removida, nunca alterada.
        Update: Record<string, never>;
        Relationships: [];
      };
      custom_field_definitions: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          type: CustomFieldType;
          /** Só usado quando `type = "select"`: lista de opções (strings). */
          options: Json;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          type: CustomFieldType;
          options?: Json;
          position?: number;
        };
        Update: {
          name?: string;
          type?: CustomFieldType;
          options?: Json;
          position?: number;
        };
        Relationships: [];
      };
      custom_field_values: {
        Row: {
          workspace_id: string;
          task_id: string;
          field_id: string;
          /** Sempre texto — número e data guardados como string; a UI formata
           *  conforme `custom_field_definitions.type`. */
          value: string | null;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          task_id: string;
          field_id: string;
          value?: string | null;
          updated_at?: string;
        };
        Update: {
          value?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          id: string;
          workspace_id: string;
          task_id: string;
          author_id: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          task_id: string;
          author_id: string;
          body: string;
        };
        Update: {
          body?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          /** Destinatário. */
          user_id: string;
          workspace_id: string;
          task_id: string | null;
          actor_id: string | null;
          type: NotificationType;
          /** Instantâneos: a lista continua legível se a tarefa mudar de nome. */
          task_title: string;
          actor_name: string;
          read_at: string | null;
          created_at: string;
        };
        // Sem `Insert`: as notificações nascem apenas pelos gatilhos do banco.
        Insert: never;
        Update: {
          read_at?: string | null;
        };
        Relationships: [];
      };
      user_access_windows: {
        Row: {
          user_id: string;
          enabled: boolean;
          /** 0 = domingo … 6 = sábado. */
          weekdays: number[];
          starts_at: string;
          ends_at: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          enabled?: boolean;
          weekdays?: number[];
          starts_at?: string;
          ends_at?: string;
          timezone?: string;
        };
        Update: {
          enabled?: boolean;
          weekdays?: number[];
          starts_at?: string;
          ends_at?: string;
          timezone?: string;
        };
        Relationships: [];
      };
      user_permissions: {
        Row: {
          user_id: string;
          role: WorkspaceRole;
          capability: string;
        };
        Insert: {
          user_id: string;
          role: WorkspaceRole;
          capability: string;
        };
        // A matriz é substituída por inserção e remoção; não há UPDATE.
        Update: Record<string, never>;
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          workspace_id: string;
          task_id: string;
          comment_id: string | null;
          storage_path: string;
          file_name: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          task_id: string;
          comment_id?: string | null;
          storage_path: string;
          file_name: string;
          mime_type?: string;
          size_bytes: number;
          uploaded_by?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      workspace_invitations: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: WorkspaceRole;
          status: InvitationStatus;
          invited_by: string | null;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: WorkspaceRole;
          invited_by?: string | null;
        };
        Update: {
          status?: InvitationStatus;
          role?: WorkspaceRole;
        };
        Relationships: [];
      };
    };
    Views: {
      /** `tasks` acrescida dos contadores de subtarefas e comentários. */
      task_overview: {
        Row: TaskRow & {
          subtask_count: number;
          subtask_done_count: number;
          comment_count: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_invitation: {
        Args: { p_invitation_id: string };
        Returns: string;
      };
      workspace_role_of: {
        Args: { p_workspace_id: string };
        Returns: WorkspaceRole;
      };
      is_workspace_member: {
        Args: { p_workspace_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      task_priority: TaskPriority;
      invitation_status: InvitationStatus;
      task_board_status: TaskBoardStatus;
      custom_field_type: CustomFieldType;
    };
    CompositeTypes: Record<never, never>;
  };
};

// ---------------------------------------------------------------------------
// Atalhos usados pela aplicação
// ---------------------------------------------------------------------------
type Tables = Database["public"]["Tables"];

export type Profile = Tables["profiles"]["Row"];
export type Workspace = Tables["workspaces"]["Row"];
export type WorkspaceMember = Tables["workspace_members"]["Row"];
export type Task = Tables["tasks"]["Row"];
export type Comment = Tables["comments"]["Row"];
export type Invitation = Tables["workspace_invitations"]["Row"];
export type Attachment = Tables["attachments"]["Row"];
export type TaskDependency = Tables["task_dependencies"]["Row"];
export type CustomFieldDefinition = Tables["custom_field_definitions"]["Row"];
export type CustomFieldValue = Tables["custom_field_values"]["Row"];

/** Campos aceitos num UPDATE de tarefa. */
export type TaskUpdate = Tables["tasks"]["Update"];

/** Linha da view `task_overview`: tarefa + contadores. */
export type TaskOverview = Database["public"]["Views"]["task_overview"]["Row"];

/** Subconjunto do perfil exibido em avatares e seletores de responsável. */
export type PersonRef = Pick<Profile, "id" | "full_name" | "email" | "avatar_url">;

export type MemberWithProfile = WorkspaceMember & {
  profile: PersonRef | null;
};
