-- Reference data for the request model: sized items, more categories, and a sample "Winter outreach kit" per chapter.
-- Size schemes: shoe (5 to 14), letter (XS to XXL), numeric (waist/size 0 to 20 style numbers) or none.

UPDATE item SET size_scheme = 'letter' WHERE slug IN ('winter-coat', 'thermal-layer');
UPDATE item SET name = 'Winter coat (clean, good condition)', new_only = 0 WHERE slug = 'winter-coat';

INSERT INTO item (id, slug, name, category, size_scheme, unit, new_only) VALUES
  (lower(hex(randomblob(16))), 'mens-winter-boots',   'Men''s winter boots',           'footwear',    'shoe',    'pair', 0),
  (lower(hex(randomblob(16))), 'womens-winter-boots', 'Women''s winter boots',         'footwear',    'shoe',    'pair', 0),
  (lower(hex(randomblob(16))), 'running-shoes',       'Running shoes or sneakers',     'footwear',    'shoe',    'pair', 0),
  (lower(hex(randomblob(16))), 'sweatshirt',          'Sweatshirt or hoodie',          'clothing',    'letter',  'each', 1),
  (lower(hex(randomblob(16))), 'sweatpants',          'Sweatpants',                    'clothing',    'letter',  'each', 1),
  (lower(hex(randomblob(16))), 'pants-numeric',       'Pants (numeric sizes)',         'clothing',    'numeric', 'each', 1),
  (lower(hex(randomblob(16))), 'phone-charger-usbc',  'Phone charger cable (USB-C)',   'electronics', 'none',    'each', 1),
  (lower(hex(randomblob(16))), 'phone-charger-lightning', 'Phone charger cable (Lightning)', 'electronics', 'none', 'each', 1),
  (lower(hex(randomblob(16))), 'power-bank',          'Portable power bank',           'electronics', 'none',    'each', 1),
  (lower(hex(randomblob(16))), 'backpack',            'Backpack',                      'bags',        'none',    'each', 0),
  (lower(hex(randomblob(16))), 'drawstring-bag',      'Drawstring bag',                'bags',        'none',    'each', 1),
  (lower(hex(randomblob(16))), 'sleeping-bag',        'Sleeping bag (new)',            'winter_gear', 'none',    'each', 1);

INSERT INTO kit_template (id, chapter_id, name, description, active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, 'Winter outreach kit',
       'Sample template: a ready-made bag of warm basics for outreach teams. Review the contents, then activate it so kit requests can use it.',
       0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM chapter c;

INSERT INTO kit_template_item (template_id, item_id, size, quantity)
SELECT t.id, i.id, '', v.qty
FROM kit_template t
JOIN (SELECT 'drawstring-bag' AS slug, 1 AS qty UNION ALL SELECT 'socks', 2 UNION ALL SELECT 'toque', 1 UNION ALL SELECT 'gloves', 1
      UNION ALL SELECT 'hand-warmers', 2 UNION ALL SELECT 'toothbrush', 1 UNION ALL SELECT 'toothpaste', 1 UNION ALL SELECT 'soap-bar', 1
      UNION ALL SELECT 'granola-bar', 2 UNION ALL SELECT 'lip-balm', 1) v
JOIN item i ON i.slug = v.slug
WHERE t.name = 'Winter outreach kit';
