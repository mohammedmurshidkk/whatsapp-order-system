-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.add_ons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT add_ons_pkey PRIMARY KEY (id),
  CONSTRAINT add_ons_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id)
);
CREATE TABLE public.business_outlets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid,
  outlet_name character varying NOT NULL,
  address text NOT NULL,
  phone character varying,
  latitude numeric,
  longitude numeric,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT business_outlets_pkey PRIMARY KEY (id),
  CONSTRAINT business_outlets_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id)
);
CREATE TABLE public.businesses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  phone character varying NOT NULL UNIQUE,
  address text,
  welcome_message text DEFAULT 'Welcome! How can I 
  help you today?'::text,
  closing_message text DEFAULT 'Thank you for 
  ordering with us!'::text,
  currency character varying DEFAULT 'INR'::character varying,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  supports_delivery boolean DEFAULT true,
  supports_takeaway boolean DEFAULT true,
  delivery_fee numeric DEFAULT 0,
  free_delivery_above numeric,
  delivery_radius_km numeric,
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT businesses_pkey PRIMARY KEY (id)
);
CREATE TABLE public.category_addons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  menu_category_id uuid,
  addon_id uuid,
  is_auto_suggested boolean DEFAULT false,
  suggestion_priority integer DEFAULT 0,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT category_addons_pkey PRIMARY KEY (id),
  CONSTRAINT category_addons_menu_category_id_fkey FOREIGN KEY (menu_category_id) REFERENCES public.menu_categories(id),
  CONSTRAINT category_addons_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES public.menu_addons(id)
);
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  phone character varying DEFAULT 'NULL'::character varying UNIQUE,
  name character varying,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id)
);
CREATE TABLE public.menu_addons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid,
  name character varying NOT NULL,
  category character varying,
  description text,
  price numeric,
  is_available boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT menu_addons_pkey PRIMARY KEY (id),
  CONSTRAINT menu_addons_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id)
);
CREATE TABLE public.menu_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid,
  name character varying NOT NULL,
  description text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT menu_categories_pkey PRIMARY KEY (id),
  CONSTRAINT menu_categories_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id)
);
CREATE TABLE public.menu_item_add_ons (
  menu_item_id uuid NOT NULL,
  add_on_id uuid NOT NULL,
  CONSTRAINT menu_item_add_ons_pkey PRIMARY KEY (menu_item_id, add_on_id),
  CONSTRAINT menu_item_add_ons_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id),
  CONSTRAINT menu_item_add_ons_add_on_id_fkey FOREIGN KEY (add_on_id) REFERENCES public.add_ons(id)
);
CREATE TABLE public.menu_item_related_items (
  menu_item_id uuid NOT NULL,
  related_item_id uuid NOT NULL,
  CONSTRAINT menu_item_related_items_pkey PRIMARY KEY (menu_item_id, related_item_id),
  CONSTRAINT menu_item_related_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id),
  CONSTRAINT menu_item_related_items_related_item_id_fkey FOREIGN KEY (related_item_id) REFERENCES public.menu_items(id)
);
CREATE TABLE public.menu_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid,
  category_id uuid,
  name character varying NOT NULL,
  description text,
  price numeric,
  sizes jsonb,
  is_customizable boolean DEFAULT false,
  requires_date boolean DEFAULT false,
  is_available boolean DEFAULT true,
  special_notes text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT menu_items_pkey PRIMARY KEY (id),
  CONSTRAINT menu_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id),
  CONSTRAINT menu_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.menu_categories(id)
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  session_id uuid,
  direction character varying NOT NULL,
  content text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id)
);
CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  session_id uuid,
  customer_id uuid,
  items jsonb NOT NULL,
  total_items integer,
  order_summary text,
  status character varying DEFAULT 'confirmed'::character varying,
  created_at timestamp without time zone DEFAULT now(),
  delivery_date date,
  total_amount numeric DEFAULT 0,
  business_id uuid,
  order_type text,
  fulfillment_details text,
  fulfillment_time timestamp with time zone,
  fulfillment_type character varying,
  delivery_address text,
  delivery_latitude numeric,
  delivery_longitude numeric,
  delivery_time timestamp without time zone,
  pickup_outlet_id uuid,
  pickup_time timestamp without time zone,
  fulfillment_notes text,
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id),
  CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id),
  CONSTRAINT orders_pickup_outlet_id_fkey FOREIGN KEY (pickup_outlet_id) REFERENCES public.business_outlets(id)
);
CREATE TABLE public.session_item_addons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_item_id uuid,
  addon_id uuid,
  addon_name character varying NOT NULL,
  quantity integer DEFAULT 1,
  unit_price numeric,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT session_item_addons_pkey PRIMARY KEY (id),
  CONSTRAINT session_item_addons_session_item_id_fkey FOREIGN KEY (session_item_id) REFERENCES public.session_items(id),
  CONSTRAINT session_item_addons_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES public.menu_addons(id)
);
CREATE TABLE public.session_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  session_id uuid,
  item_name character varying NOT NULL,
  quantity integer DEFAULT 1,
  size_or_weight character varying,
  custom_text text,
  delivery_date date,
  notes text,
  ai_raw jsonb,
  created_at timestamp without time zone DEFAULT now(),
  unit_price numeric,
  add_ons jsonb,
  item_fulfillment_type character varying,
  CONSTRAINT session_items_pkey PRIMARY KEY (id),
  CONSTRAINT session_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id)
);
CREATE TABLE public.sessions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  customer_id uuid,
  status character varying DEFAULT 'active'::character varying,
  created_at timestamp without time zone DEFAULT now(),
  last_message_at timestamp without time zone DEFAULT now(),
  completed_at timestamp without time zone,
  total_items integer DEFAULT 0,
  ai_paused boolean DEFAULT false,
  paused_at timestamp without time zone,
  paused_by character varying,
  business_id character varying,
  session_state text DEFAULT 'ordering'::text,
  fulfillment_type text,
  fulfillment_details text,
  fulfillment_time text,
  delivery_address text,
  delivery_latitude numeric,
  delivery_longitude numeric,
  delivery_time timestamp without time zone,
  pickup_outlet_id uuid,
  pickup_time timestamp without time zone,
  fulfillment_notes text,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id),
  CONSTRAINT sessions_pickup_outlet_id_fkey FOREIGN KEY (pickup_outlet_id) REFERENCES public.business_outlets(id)
);