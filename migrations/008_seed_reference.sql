-- Reference data: the shared item catalog, the two launch chapters and a sample (inactive) "Winter kit".
-- Chapters are ordinary rows: a new campus is added with the admin page or `npm run admin:add-chapter`
-- (docs/START-A-CHAPTER.md); no code change is needed.
-- Categories: hygiene, clothing, winter_gear, menstrual, first_aid, snacks_sealed, other.
-- new_only = 1: only new, unopened items. new_only = 0: clean, good-condition second-hand items are fine.

INSERT INTO item (id, slug, name, category, unit, new_only) VALUES
  (lower(hex(randomblob(16))), 'toothbrush',       'Toothbrush',                      'hygiene',       'each',    1),
  (lower(hex(randomblob(16))), 'toothpaste',       'Toothpaste (travel size)',        'hygiene',       'tube',    1),
  (lower(hex(randomblob(16))), 'soap-bar',         'Soap bar',                        'hygiene',       'bar',     1),
  (lower(hex(randomblob(16))), 'deodorant',        'Deodorant',                       'hygiene',       'each',    1),
  (lower(hex(randomblob(16))), 'shampoo-travel',   'Shampoo (travel size)',           'hygiene',       'bottle',  1),
  (lower(hex(randomblob(16))), 'wet-wipes',        'Wet wipes',                       'hygiene',       'pack',    1),
  (lower(hex(randomblob(16))), 'lip-balm',         'Lip balm',                        'hygiene',       'each',    1),
  (lower(hex(randomblob(16))), 'socks',            'Socks',                           'clothing',      'pair',    1),
  (lower(hex(randomblob(16))), 'underwear',        'Underwear',                       'clothing',      'pair',    1),
  (lower(hex(randomblob(16))), 'toque',            'Toque (winter hat)',              'winter_gear',   'each',    1),
  (lower(hex(randomblob(16))), 'gloves',           'Gloves or mittens',               'winter_gear',   'pair',    1),
  (lower(hex(randomblob(16))), 'scarf',            'Scarf or neck warmer',            'winter_gear',   'each',    1),
  (lower(hex(randomblob(16))), 'hand-warmers',     'Hand warmers',                    'winter_gear',   'pair',    1),
  (lower(hex(randomblob(16))), 'winter-coat',      'Winter coat (clean, good condition)', 'winter_gear', 'each',  0),
  (lower(hex(randomblob(16))), 'thermal-layer',    'Thermal base layer',              'winter_gear',   'each',    1),
  (lower(hex(randomblob(16))), 'pads',             'Menstrual pads',                  'menstrual',     'pack',    1),
  (lower(hex(randomblob(16))), 'tampons',          'Tampons',                         'menstrual',     'box',     1),
  (lower(hex(randomblob(16))), 'bandages',         'Adhesive bandages',               'first_aid',     'box',     1),
  (lower(hex(randomblob(16))), 'antiseptic-wipes', 'Antiseptic wipes',                'first_aid',     'box',     1),
  (lower(hex(randomblob(16))), 'blister-pads',     'Blister pads',                    'first_aid',     'box',     1),
  (lower(hex(randomblob(16))), 'granola-bar',      'Granola bar (sealed)',            'snacks_sealed', 'each',    1),
  (lower(hex(randomblob(16))), 'crackers',         'Crackers or cookies (sealed pack)', 'snacks_sealed', 'pack',  1),
  (lower(hex(randomblob(16))), 'fruit-cup',        'Fruit cup or applesauce (sealed)', 'snacks_sealed', 'each',   1),
  (lower(hex(randomblob(16))), 'trail-mix',       'Trail mix, single serving (sealed)', 'snacks_sealed', 'each', 1),
  (lower(hex(randomblob(16))), 'tissues',          'Pocket tissues',                  'other',         'pack',    1),
  (lower(hex(randomblob(16))), 'water-bottle',     'Reusable water bottle',           'other',         'each',    1);

INSERT INTO chapter (id, slug, name, city, timezone, active, created_at) VALUES
  (lower(hex(randomblob(16))), 'london', 'London (Western)',       'London, ON', 'America/Toronto', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'oshawa', 'Oshawa (Ontario Tech)',  'Oshawa, ON', 'America/Toronto', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One sample template per chapter. Inactive and with a zero target, so nothing appears on the public
-- board until a coordinator reviews the contents, sets a weekly target and activates it.
INSERT INTO package_template (id, chapter_id, name, description, weekly_target, active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, 'Winter kit',
       'Sample template: warm basics for a cold night. Edit the contents and set a weekly target, then activate it.',
       0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM chapter c;

INSERT INTO package_template_item (template_id, item_id, quantity)
SELECT t.id, i.id, v.qty
FROM package_template t
JOIN (SELECT 'socks' AS slug, 2 AS qty UNION ALL SELECT 'toque', 1 UNION ALL SELECT 'gloves', 1
      UNION ALL SELECT 'toothbrush', 1 UNION ALL SELECT 'toothpaste', 1 UNION ALL SELECT 'soap-bar', 1
      UNION ALL SELECT 'hand-warmers', 2 UNION ALL SELECT 'granola-bar', 2 UNION ALL SELECT 'lip-balm', 1) v
JOIN item i ON i.slug = v.slug
WHERE t.name = 'Winter kit';
