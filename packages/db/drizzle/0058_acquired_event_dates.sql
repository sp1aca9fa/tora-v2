-- S10 part B: a corrected purchase date did not move the lot's "acquired" event; move it now for
-- lots whose date was edited.
UPDATE `holding_events` SET `occurred_at` = (
  SELECT `acquired_at` FROM `holdings` WHERE `holdings`.`id` = `holding_events`.`holding_id`
)
WHERE `type` = 'acquired'
  AND `holding_id` IN (
    SELECT `holding_id` FROM `holding_events`
    WHERE `type` = 'note' AND json_extract(`payload`, '$.changes.acquiredAt') IS NOT NULL
  );
