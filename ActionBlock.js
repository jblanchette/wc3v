const ActionBlockNames = {
  0x01: 'Pause',
  0x02:'Resume',
  0x03: 'SetSpeed',
  0x04: 'IncreaseSpeed',
  0x05: 'DecreaseSpeed',
  0x06: 'SaveGame',
  0x07: 'SaveGameDone',
  0x10: 'UseAbilityNoTarget',
  0x11: 'UseAbilityWithTarget',
  0x12: 'UseAbilityWithTargetAndObjectId',
  0x13: 'GiveOrDropItem',
  0x14: 'UseAbilityTwoTargets',
  0x16: 'ChangeSelection',
  0x17: 'AssingGroupHotkey',
  0x18: 'SelectGroupHotkey',
  0x19: 'SelectSubgroup',
  0x1A: 'UpdateSubgroup',
  0x1B: 'Unknown',
  0x1C: 'SelectGroundItem',
  0x1D: 'CancelHeroRevival',
  0x1E: 'RemoveFromQueue',
  0x50: 'ChangeAllys',
  0x51: 'TransferResources',
  0x60: 'ChatTrigger',
  0x61: 'EscapePressed',
  0x62: 'ScenarioTrigger',
  0x66: 'SelectHeroSkill',
  0x67: 'ChooseBuilding',
  0x68: 'MinimapSignal',
  0x69: 'ContinueGame',
  0x6A: 'ContinueGame',
  0x6A: 'Unknown'
};

module.exports = {
  ActionBlockNames: ActionBlockNames
};