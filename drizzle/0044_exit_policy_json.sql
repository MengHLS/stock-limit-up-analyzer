-- @guard: column strategy_exit_rules.policyJson
ALTER TABLE `strategy_exit_rules`
  ADD COLUMN `policyJson` LONGTEXT NULL;
