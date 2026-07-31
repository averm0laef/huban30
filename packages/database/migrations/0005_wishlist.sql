CREATE TABLE app.wishlist_items (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX wishlist_items_recent_idx ON app.wishlist_items (user_id, created_at DESC);

COMMENT ON TABLE app.wishlist_items IS
  'Persistent customer wishlist; API authorization must always scope rows to the authenticated user.';
