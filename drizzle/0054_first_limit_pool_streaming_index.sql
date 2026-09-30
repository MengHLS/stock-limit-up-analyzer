CREATE INDEX `idx_ds_flp_post_version_day_event`
  ON `ds_first_limit_pullback_post` (`datasetVersionId`, `relativeDay`, `eventId`);
