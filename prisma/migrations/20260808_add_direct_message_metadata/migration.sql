ALTER TABLE `direct_messages`
  ADD COLUMN `metadata` LONGTEXT NULL AFTER `message_type`;
