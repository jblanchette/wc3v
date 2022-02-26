gg_trg_Melee_Initialization = nil
function InitGlobals()
end

function Unit000002_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000026_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 4), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000031_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000034_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000038_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000043_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000044_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000052_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000057_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000058_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000063_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000065_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000070_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 4), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000073_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000077_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000079_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000080_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000082_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000085_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000087_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000088_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000090_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000094_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000096_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000097_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000099_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000100_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000101_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000105_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000111_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000112_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000115_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000117_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000118_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000120_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000124_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000129_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000131_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000133_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000138_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000141_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000146_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000147_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000151_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000153_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000155_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000158_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000161_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000164_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000166_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000168_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000172_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000182_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000183_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000186_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000187_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000188_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 3), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000189_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000192_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_CHARGED, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000195_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000218_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000219_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 1), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000220_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000222_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_POWERUP, 2), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function Unit000223_DropItems()
    local trigWidget = nil
    local trigUnit = nil
    local itemID = 0
    local canDrop = true
    trigWidget = bj_lastDyingWidget
    if (trigWidget == nil) then
        trigUnit = GetTriggerUnit()
    end
    if (trigUnit ~= nil) then
        canDrop = not IsUnitHidden(trigUnit)
        if (canDrop and GetChangingUnit() ~= nil) then
            canDrop = (GetChangingUnitPrevOwner() == Player(PLAYER_NEUTRAL_AGGRESSIVE))
        end
    end
    if (canDrop) then
        RandomDistReset()
        RandomDistAddItem(ChooseRandomItemEx(ITEM_TYPE_PERMANENT, 5), 100)
        itemID = RandomDistChoose()
        if (trigUnit ~= nil) then
            UnitDropItem(trigUnit, itemID)
        else
            WidgetDropItem(trigWidget, itemID)
        end
    end
    bj_lastDyingWidget = nil
    DestroyTrigger(GetTriggeringTrigger())
end

function CreateNeutralHostile()
    local p = Player(PLAYER_NEUTRAL_AGGRESSIVE)
    local u
    local unitID
    local t
    local life
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), -5789.8, -7156.0, 73.330, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nogr"), -3247.7, -3793.6, 19.501, FourCC("nogr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nmtw"), 6886.0, -213.8, 135.704, FourCC("nmtw"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000219_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), -6754.4, -241.3, 307.903, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), -4584.2, -4579.5, 268.067, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -1612.0, -7549.8, 92.406, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000129_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -3543.6, -3538.7, 39.644, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), -1822.7, -7523.5, 118.430, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlt"), -560.2, 7377.4, 292.764, FourCC("nwlt"))
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -1417.8, -7427.2, 138.799, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), 6942.4, -3123.8, 226.553, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 7007.1, -3001.7, 234.845, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 6948.8, -3297.9, 205.164, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000124_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 7768.9, 2571.4, 178.421, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), 7649.0, 2833.9, 216.487, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 7718.7, 2701.3, 214.971, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000077_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlt"), -2048.3, 2770.2, 151.746, FourCC("nwlt"))
    u = BlzCreateUnitWithSkin(p, FourCC("nmrv"), 6981.5, -116.2, 154.399, FourCC("nmrv"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000192_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 4678.9, 4040.0, 71.089, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -7532.2, -3417.5, 64.769, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), -7651.4, -3318.8, 39.167, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -7688.9, -3186.1, 7.950, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000044_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -1709.0, 6951.9, 267.422, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), -2077.8, 7041.8, 263.807, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -1887.2, 7040.8, 264.846, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000034_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -6971.3, 2758.9, 41.264, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000038_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), -7147.7, 2904.0, 19.683, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -6915.3, 2632.2, 347.139, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 2003.5, 6977.1, 249.127, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), 1860.6, 7053.5, 248.140, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 1667.6, 7036.7, 297.954, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000031_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), 4175.8, -5204.7, 173.686, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), -4282.8, -4858.9, 221.020, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), 6216.1, 6360.7, 224.709, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlg"), -7780.0, -1444.8, 308.120, FourCC("nwlg"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000002_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 4249.1, 4403.8, 54.476, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), -8291.4, -1719.7, 318.931, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), -7961.6, -1429.0, 297.756, FourCC("nbrg"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), 3833.6, -7760.4, 93.520, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000079_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), -3634.4, -7811.8, 93.520, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000101_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 3591.9, -7842.2, 85.230, FourCC("ngst"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000080_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 4030.6, -7834.5, 153.279, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), 7052.3, -5091.4, 180.290, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000082_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 7187.7, -4883.6, 206.493, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("nwlg"), 2493.1, -2863.4, 294.351, FourCC("nwlg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000147_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlt"), 2083.0, -3264.3, 323.168, FourCC("nwlt"))
    u = BlzCreateUnitWithSkin(p, FourCC("nwzg"), -8064.1, -1714.9, 310.230, FourCC("nwzg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000182_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nwzg"), 2299.0, -3104.4, 315.672, FourCC("nwzg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000146_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nsqo"), -1776.4, -308.6, 308.454, FourCC("nsqo"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000026_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nftr"), -1910.7, -471.6, 343.684, FourCC("nftr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), -2364.9, 2462.7, 139.610, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nwzg"), -2271.1, 2618.3, 140.146, FourCC("nwzg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000065_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -3214.2, -3967.0, 33.090, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000164_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), 6801.1, -274.3, 118.369, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), 5763.7, 6689.0, 224.709, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 1893.7, -7551.1, 73.747, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000120_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), 87.7, -5189.1, 11.341, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -107.8, -4764.1, 3.906, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000187_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), -48.8, -7903.5, 97.895, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), -5872.2, 6734.3, 254.074, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngnb"), 6009.0, -7102.0, 130.480, FourCC("ngnb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngns"), 6133.4, -6950.2, 145.488, FourCC("ngns"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000118_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), 281.3, -7898.6, 96.505, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nwzg"), 134.6, -7834.6, 96.960, FourCC("nwzg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000151_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 7173.9, -5353.1, 188.505, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), 3947.9, -5468.9, 114.658, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 7396.8, 4850.7, 182.996, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), 7039.8, 14.9, 170.766, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 7408.6, 4332.0, 189.535, FourCC("ngst"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000085_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 3364.5, 7420.4, 266.185, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), 2365.8, -2950.4, 307.313, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), -3818.9, 7291.7, 267.844, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000133_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -4093.7, 7353.5, 266.185, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -3608.2, 7334.7, 282.311, FourCC("ngst"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000131_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), 3580.8, 7292.1, 267.844, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000090_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -7105.8, 4351.2, 7.644, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 3811.9, 7413.5, 257.051, FourCC("ngst"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000088_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -7093.9, 4872.6, 345.610, FourCC("ngst"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000094_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -7364.7, -5345.6, 14.897, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), -7012.2, 4610.7, 355.761, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000096_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -7316.2, -4828.9, 11.423, FourCC("ngst"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000097_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), -7351.1, -5069.2, 353.084, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000099_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -3431.5, -7857.5, 104.402, FourCC("ngst"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 4098.0, -5383.8, 142.750, FourCC("ngst"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000105_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 3803.9, -5463.6, 119.380, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlg"), 402.9, -7913.7, 101.485, FourCC("nwlg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000111_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 4189.4, -5053.5, 161.141, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlg"), 129.8, 7438.9, 248.966, FourCC("nwlg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000153_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngnb"), -6212.3, 6624.3, 311.242, FourCC("ngnb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkot"), 2053.1, -7553.2, 76.360, FourCC("nkot"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlt"), -177.8, -7926.7, 79.869, FourCC("nwlt"))
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 2214.1, -7520.9, 140.626, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngnb"), -6128.6, -7003.9, 47.948, FourCC("ngnb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), -6252.6, 6414.8, 327.179, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), -6185.7, -6849.5, 53.058, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), 6192.5, -6779.3, 162.865, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -3808.4, -7897.9, 85.230, FourCC("ngst"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000100_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), -412.0, 7396.4, 277.883, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), -22.2, 7429.5, 266.166, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nowk"), 7317.0, 4610.7, 190.172, FourCC("nowk"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000087_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), 2149.6, -3178.4, 309.057, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -4117.3, 4874.6, 324.140, FourCC("ngst"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000138_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nsqo"), 1706.0, -194.9, 166.000, FourCC("nsqo"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000070_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 1991.9, -38.6, 126.053, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 1730.6, -402.5, 167.342, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -1872.0, -66.4, 319.762, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -2087.7, -505.6, 339.654, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftr"), 1837.3, -11.1, 169.194, FourCC("nftr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -3853.2, 5011.8, 297.169, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -4189.6, 4610.9, 2.622, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), -3984.0, 4975.6, 298.719, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), -4183.8, 4745.1, 340.644, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), 4420.0, 4124.5, 58.870, FourCC("ngst"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000117_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), 4549.5, 4026.6, 72.491, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrk"), 4259.3, 4274.2, 39.090, FourCC("ngrk"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -4232.8, -4949.7, 223.320, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -4691.8, -4523.5, 264.393, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngst"), -4401.4, -4702.4, 232.350, FourCC("ngst"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000073_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlg"), -2447.0, 2343.9, 131.968, FourCC("nwlg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000063_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), 8289.6, 1112.8, 137.095, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), -2109.7, 2646.9, 139.435, FourCC("nbrg"))
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -6569.9, 999.3, 315.350, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000222_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nbrg"), 7968.3, 806.9, 134.790, FourCC("nbrg"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlt"), 8340.1, 1277.3, 162.667, FourCC("nwlt"))
    u = BlzCreateUnitWithSkin(p, FourCC("nwlg"), 7771.1, 849.7, 137.770, FourCC("nwlg"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000189_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nwzg"), -187.9, 7340.0, 277.939, FourCC("nwzg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000115_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), -7068.3, -461.2, 327.043, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 3632.1, 3109.2, 243.298, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nmtw"), -6871.5, -257.8, 301.640, FourCC("nmtw"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000218_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrv"), -6969.8, -336.9, 314.839, FourCC("nmrv"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000043_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngnb"), -92.6, -4941.5, 57.807, FourCC("ngnb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nfsp"), 170.6, -5328.9, 61.052, FourCC("nfsp"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngnv"), 34.1, -5043.4, 42.013, FourCC("ngnv"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000188_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nomg"), -3351.2, -3628.4, 40.040, FourCC("nomg"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000058_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nomg"), 3414.8, 3143.0, 218.910, FourCC("nomg"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000166_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nogr"), 3267.1, 3274.4, 219.961, FourCC("nogr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 3157.9, 3434.6, 234.796, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000168_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngns"), 5932.8, 6623.7, 257.836, FourCC("ngns"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000172_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), 5827.7, -7125.8, 111.818, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngnb"), 6108.4, 6524.3, 238.044, FourCC("ngnb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngns"), -6047.8, 6711.0, 300.378, FourCC("ngns"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000052_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngns"), -5964.4, -7103.1, 50.140, FourCC("ngns"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000112_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nwlt"), -8325.7, -1846.2, 313.029, FourCC("nwlt"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngnv"), -138.4, 4509.5, 211.438, FourCC("ngnv"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000183_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nfsp"), -269.9, 4938.2, 235.857, FourCC("nfsp"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngna"), -199.6, 4670.1, 228.117, FourCC("ngna"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -13.2, 4373.9, 205.905, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000161_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("ngnb"), -170.3, 4826.0, 228.789, FourCC("ngnb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), -1086.9, 1235.9, 333.584, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrv"), 960.0, -1859.5, 125.270, FourCC("nmrv"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000155_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), -840.3, 1372.2, 253.809, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrv"), -988.9, 1354.5, 278.454, FourCC("nmrv"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000057_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmtw"), -1115.1, 1110.7, 2.801, FourCC("nmtw"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000158_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), 1073.0, -1717.2, 147.641, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nmtw"), 1048.9, -1581.0, 181.453, FourCC("nmtw"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000186_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrr"), 804.3, -1903.7, 69.976, FourCC("nmrr"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 1728.2, -7510.6, 72.922, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 7095.0, -3413.2, 234.845, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 7535.1, 2907.4, 234.845, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), 1511.8, 6939.2, 270.088, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -2225.4, 6965.2, 262.692, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -7048.4, 2504.3, 23.036, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -7683.4, -3039.7, 9.538, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nkob"), -1964.7, -7463.9, 126.114, FourCC("nkob"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nwzg"), 8105.2, 1128.6, 136.493, FourCC("nwzg"))
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000141_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkog"), -6412.8, 991.0, 303.585, FourCC("nkog"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), -6001.2, 1216.3, 284.356, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nggr"), 6211.6, -1644.5, 130.981, FourCC("nggr"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000220_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nkog"), 6371.9, -1476.3, 132.544, FourCC("nkog"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 6065.6, -1765.0, 116.575, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nftb"), 6582.7, -1476.4, 129.500, FourCC("nftb"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000195_DropItems)
    u = BlzCreateUnitWithSkin(p, FourCC("nggr"), -6187.7, 1116.0, 305.910, FourCC("nggr"))
    SetUnitAcquireRange(u, 200.0)
    t = CreateTrigger()
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_DEATH)
    TriggerRegisterUnitEvent(t, u, EVENT_UNIT_CHANGE_OWNER)
    TriggerAddAction(t, Unit000223_DropItems)
end

function CreateNeutralPassiveBuildings()
    local p = Player(PLAYER_NEUTRAL_PASSIVE)
    local u
    local unitID
    local t
    local life
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -1984.0, -256.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 18000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 1920.0, -256.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 18000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 2176.0, -2944.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 12500)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -2176.0, 2432.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 12500)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 7296.0, -5120.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 3840.0, -8064.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -3584.0, -8064.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -7552.0, -5120.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -7296.0, 4608.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -3840.0, 7552.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 3584.0, 7552.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 7552.0, 4608.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 14000)
    u = BlzCreateUnitWithSkin(p, FourCC("ntav"), -3648.0, -256.0, 270.000, FourCC("ntav"))
    SetUnitColor(u, ConvertPlayerColor(0))
    u = BlzCreateUnitWithSkin(p, FourCC("ntav"), 3648.0, -256.0, 270.000, FourCC("ntav"))
    SetUnitColor(u, ConvertPlayerColor(0))
    u = BlzCreateUnitWithSkin(p, FourCC("ngme"), 3456.0, 3328.0, 270.000, FourCC("ngme"))
    u = BlzCreateUnitWithSkin(p, FourCC("ngme"), -3456.0, -3840.0, 270.000, FourCC("ngme"))
    u = BlzCreateUnitWithSkin(p, FourCC("nmr8"), -128.0, -5184.0, 270.000, FourCC("nmr8"))
    SetUnitColor(u, ConvertPlayerColor(9))
    u = BlzCreateUnitWithSkin(p, FourCC("nmr8"), 0.0, 4672.0, 270.000, FourCC("nmr8"))
    SetUnitColor(u, ConvertPlayerColor(9))
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 128.0, -8064.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 15000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -192.0, 7552.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 15000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), 8128.0, 960.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 15000)
    u = BlzCreateUnitWithSkin(p, FourCC("ngol"), -8128.0, -1536.0, 270.000, FourCC("ngol"))
    SetResourceAmount(u, 15000)
    u = BlzCreateUnitWithSkin(p, FourCC("nmrk"), 6400.0, -1664.0, 270.000, FourCC("nmrk"))
    SetUnitColor(u, ConvertPlayerColor(0))
    u = BlzCreateUnitWithSkin(p, FourCC("nmrk"), -6400.0, 1152.0, 270.000, FourCC("nmrk"))
    SetUnitColor(u, ConvertPlayerColor(0))
end

function CreateNeutralPassive()
    local p = Player(PLAYER_NEUTRAL_PASSIVE)
    local u
    local unitID
    local t
    local life
    u = BlzCreateUnitWithSkin(p, FourCC("nfro"), -5407.5, -524.1, 222.946, FourCC("nfro"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nfro"), 5361.3, 67.6, 36.590, FourCC("nfro"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("ngrw"), -8262.0, 1901.0, 250.627, FourCC("ngrw"))
    u = BlzCreateUnitWithSkin(p, FourCC("nshe"), -890.8, -1576.9, 289.591, FourCC("nshe"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("npig"), 1030.3, 905.7, 133.300, FourCC("npig"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nshe"), 5814.5, -3366.7, 289.591, FourCC("nshe"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("npig"), 2102.2, -6429.8, 292.559, FourCC("npig"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nshe"), -2023.2, -6314.0, 289.591, FourCC("nshe"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("npig"), -6152.6, -3221.5, 219.443, FourCC("npig"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nshe"), -5749.3, 2771.2, 289.591, FourCC("nshe"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("npig"), -2005.9, 6050.8, 23.775, FourCC("npig"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nshe"), 2052.7, 5973.8, 289.591, FourCC("nshe"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("npig"), 6207.9, 2918.0, 23.775, FourCC("npig"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nfro"), 5381.5, 5648.4, 192.680, FourCC("nfro"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nfro"), -4923.9, 5612.2, 326.480, FourCC("nfro"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nfro"), -5254.3, -6043.9, 326.480, FourCC("nfro"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nfro"), 4701.6, -5829.0, 326.480, FourCC("nfro"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nshe"), 3276.5, -4149.4, 289.591, FourCC("nshe"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("nshe"), -3370.0, 3612.0, 289.591, FourCC("nshe"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("npig"), -2541.2, -2703.8, 334.240, FourCC("npig"))
    SetUnitAcquireRange(u, 200.0)
    u = BlzCreateUnitWithSkin(p, FourCC("npig"), 2694.0, 2270.1, 334.240, FourCC("npig"))
    SetUnitAcquireRange(u, 200.0)
end

function CreatePlayerBuildings()
end

function CreatePlayerUnits()
end

function CreateAllUnits()
    CreateNeutralPassiveBuildings()
    CreatePlayerBuildings()
    CreateNeutralHostile()
    CreateNeutralPassive()
    CreatePlayerUnits()
end

function Trig_Melee_Initialization_Actions()
    MeleeStartingVisibility()
    MeleeStartingHeroLimit()
    MeleeGrantHeroItems()
    MeleeStartingResources()
    MeleeClearExcessUnits()
    MeleeStartingUnits()
    MeleeStartingAI()
    MeleeInitVictoryDefeat()
end

function InitTrig_Melee_Initialization()
    gg_trg_Melee_Initialization = CreateTrigger()
    TriggerAddAction(gg_trg_Melee_Initialization, Trig_Melee_Initialization_Actions)
end

function InitCustomTriggers()
    InitTrig_Melee_Initialization()
end

function RunInitializationTriggers()
    ConditionalTriggerExecute(gg_trg_Melee_Initialization)
end

function InitCustomPlayerSlots()
    SetPlayerStartLocation(Player(0), 0)
    SetPlayerColor(Player(0), ConvertPlayerColor(0))
    SetPlayerRacePreference(Player(0), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(0), true)
    SetPlayerController(Player(0), MAP_CONTROL_USER)
    SetPlayerStartLocation(Player(1), 1)
    SetPlayerColor(Player(1), ConvertPlayerColor(1))
    SetPlayerRacePreference(Player(1), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(1), true)
    SetPlayerController(Player(1), MAP_CONTROL_USER)
    SetPlayerStartLocation(Player(2), 2)
    SetPlayerColor(Player(2), ConvertPlayerColor(2))
    SetPlayerRacePreference(Player(2), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(2), true)
    SetPlayerController(Player(2), MAP_CONTROL_USER)
    SetPlayerStartLocation(Player(3), 3)
    SetPlayerColor(Player(3), ConvertPlayerColor(3))
    SetPlayerRacePreference(Player(3), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(3), true)
    SetPlayerController(Player(3), MAP_CONTROL_USER)
    SetPlayerStartLocation(Player(4), 4)
    SetPlayerColor(Player(4), ConvertPlayerColor(4))
    SetPlayerRacePreference(Player(4), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(4), true)
    SetPlayerController(Player(4), MAP_CONTROL_USER)
    SetPlayerStartLocation(Player(5), 5)
    SetPlayerColor(Player(5), ConvertPlayerColor(5))
    SetPlayerRacePreference(Player(5), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(5), true)
    SetPlayerController(Player(5), MAP_CONTROL_USER)
    SetPlayerStartLocation(Player(6), 6)
    SetPlayerColor(Player(6), ConvertPlayerColor(6))
    SetPlayerRacePreference(Player(6), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(6), true)
    SetPlayerController(Player(6), MAP_CONTROL_USER)
    SetPlayerStartLocation(Player(7), 7)
    SetPlayerColor(Player(7), ConvertPlayerColor(7))
    SetPlayerRacePreference(Player(7), RACE_PREF_RANDOM)
    SetPlayerRaceSelectable(Player(7), true)
    SetPlayerController(Player(7), MAP_CONTROL_USER)
end

function InitCustomTeams()
    SetPlayerTeam(Player(0), 0)
    SetPlayerTeam(Player(1), 0)
    SetPlayerTeam(Player(2), 0)
    SetPlayerTeam(Player(3), 0)
    SetPlayerTeam(Player(4), 0)
    SetPlayerTeam(Player(5), 0)
    SetPlayerTeam(Player(6), 0)
    SetPlayerTeam(Player(7), 0)
end

function InitAllyPriorities()
    SetStartLocPrioCount(0, 7)
    SetStartLocPrio(0, 0, 1, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(0, 1, 2, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(0, 2, 3, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(0, 3, 4, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(0, 4, 5, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(0, 5, 6, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(0, 6, 7, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrioCount(0, 7)
    SetEnemyStartLocPrio(0, 0, 1, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(0, 1, 2, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(0, 2, 3, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(0, 3, 4, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(0, 4, 5, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(0, 5, 6, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(0, 6, 7, MAP_LOC_PRIO_HIGH)
    SetStartLocPrioCount(1, 7)
    SetStartLocPrio(1, 0, 0, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(1, 1, 2, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(1, 2, 3, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(1, 3, 4, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(1, 4, 5, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(1, 5, 6, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(1, 6, 7, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrioCount(1, 7)
    SetEnemyStartLocPrio(1, 0, 0, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(1, 1, 2, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(1, 2, 3, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(1, 3, 4, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(1, 4, 5, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(1, 5, 6, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(1, 6, 7, MAP_LOC_PRIO_HIGH)
    SetStartLocPrioCount(2, 7)
    SetStartLocPrio(2, 0, 0, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(2, 1, 1, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(2, 2, 3, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(2, 3, 4, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(2, 4, 5, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(2, 5, 6, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(2, 6, 7, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrioCount(2, 7)
    SetEnemyStartLocPrio(2, 0, 0, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(2, 1, 1, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(2, 2, 3, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(2, 3, 4, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(2, 4, 5, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(2, 5, 6, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(2, 6, 7, MAP_LOC_PRIO_HIGH)
    SetStartLocPrioCount(3, 7)
    SetStartLocPrio(3, 0, 0, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(3, 1, 1, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(3, 2, 2, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(3, 3, 4, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(3, 4, 5, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(3, 5, 6, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(3, 6, 7, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrioCount(3, 7)
    SetEnemyStartLocPrio(3, 0, 0, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(3, 1, 1, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(3, 2, 2, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(3, 3, 4, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(3, 4, 5, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(3, 5, 6, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(3, 6, 7, MAP_LOC_PRIO_HIGH)
    SetStartLocPrioCount(4, 7)
    SetStartLocPrio(4, 0, 0, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(4, 1, 1, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(4, 2, 2, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(4, 3, 3, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(4, 4, 5, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(4, 5, 6, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(4, 6, 7, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrioCount(4, 7)
    SetEnemyStartLocPrio(4, 0, 0, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(4, 1, 1, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(4, 2, 2, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(4, 3, 3, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(4, 4, 5, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(4, 5, 6, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(4, 6, 7, MAP_LOC_PRIO_LOW)
    SetStartLocPrioCount(5, 7)
    SetStartLocPrio(5, 0, 0, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(5, 1, 1, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(5, 2, 2, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(5, 3, 3, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(5, 4, 4, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(5, 5, 6, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(5, 6, 7, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrioCount(5, 7)
    SetEnemyStartLocPrio(5, 0, 0, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(5, 1, 1, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(5, 2, 2, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(5, 3, 3, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(5, 4, 4, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(5, 5, 6, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(5, 6, 7, MAP_LOC_PRIO_LOW)
    SetStartLocPrioCount(6, 7)
    SetStartLocPrio(6, 0, 0, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(6, 1, 1, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(6, 2, 2, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(6, 3, 3, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(6, 4, 4, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(6, 5, 5, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(6, 6, 7, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrioCount(6, 7)
    SetEnemyStartLocPrio(6, 0, 0, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(6, 1, 1, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(6, 2, 2, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(6, 3, 3, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(6, 4, 4, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(6, 5, 5, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(6, 6, 7, MAP_LOC_PRIO_LOW)
    SetStartLocPrioCount(7, 7)
    SetStartLocPrio(7, 0, 0, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(7, 1, 1, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(7, 2, 2, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(7, 3, 3, MAP_LOC_PRIO_LOW)
    SetStartLocPrio(7, 4, 4, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(7, 5, 5, MAP_LOC_PRIO_HIGH)
    SetStartLocPrio(7, 6, 6, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrioCount(7, 7)
    SetEnemyStartLocPrio(7, 0, 0, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(7, 1, 1, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(7, 2, 2, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(7, 3, 3, MAP_LOC_PRIO_HIGH)
    SetEnemyStartLocPrio(7, 4, 4, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(7, 5, 5, MAP_LOC_PRIO_LOW)
    SetEnemyStartLocPrio(7, 6, 6, MAP_LOC_PRIO_LOW)
end

function main()
    SetCameraBounds(-8960.0 + GetCameraMargin(CAMERA_MARGIN_LEFT), -9216.0 + GetCameraMargin(CAMERA_MARGIN_BOTTOM), 8960.0 - GetCameraMargin(CAMERA_MARGIN_RIGHT), 8704.0 - GetCameraMargin(CAMERA_MARGIN_TOP), -8960.0 + GetCameraMargin(CAMERA_MARGIN_LEFT), 8704.0 - GetCameraMargin(CAMERA_MARGIN_TOP), 8960.0 - GetCameraMargin(CAMERA_MARGIN_RIGHT), -9216.0 + GetCameraMargin(CAMERA_MARGIN_BOTTOM))
    SetDayNightModels("Environment\\DNC\\DNCLordaeron\\DNCLordaeronTerrain\\DNCLordaeronTerrain.mdl", "Environment\\DNC\\DNCLordaeron\\DNCLordaeronUnit\\DNCLordaeronUnit.mdl")
    NewSoundEnvironment("Default")
    SetAmbientDaySound("AshenvaleDay")
    SetAmbientNightSound("AshenvaleNight")
    SetMapMusic("Music", true, 0)
    CreateAllUnits()
    InitBlizzard()
    InitGlobals()
    InitCustomTriggers()
    RunInitializationTriggers()
end

function config()
    SetMapName("TRIGSTR_001")
    SetMapDescription("TRIGSTR_003")
    SetPlayers(8)
    SetTeams(8)
    SetGamePlacement(MAP_PLACEMENT_TEAMS_TOGETHER)
    DefineStartLocation(0, -6528.0, 4544.0)
    DefineStartLocation(1, -3776.0, 6784.0)
    DefineStartLocation(2, 3520.0, 6784.0)
    DefineStartLocation(3, 6784.0, 4544.0)
    DefineStartLocation(4, 6528.0, -5056.0)
    DefineStartLocation(5, 3776.0, -7296.0)
    DefineStartLocation(6, -3520.0, -7296.0)
    DefineStartLocation(7, -6784.0, -5056.0)
    InitCustomPlayerSlots()
    SetPlayerSlotAvailable(Player(0), MAP_CONTROL_USER)
    SetPlayerSlotAvailable(Player(1), MAP_CONTROL_USER)
    SetPlayerSlotAvailable(Player(2), MAP_CONTROL_USER)
    SetPlayerSlotAvailable(Player(3), MAP_CONTROL_USER)
    SetPlayerSlotAvailable(Player(4), MAP_CONTROL_USER)
    SetPlayerSlotAvailable(Player(5), MAP_CONTROL_USER)
    SetPlayerSlotAvailable(Player(6), MAP_CONTROL_USER)
    SetPlayerSlotAvailable(Player(7), MAP_CONTROL_USER)
    InitGenericPlayerSlots()
    InitAllyPriorities()
end


local ____modules = {}
local ____moduleCache = {}
local ____originalRequire = require
local function require(file)
    if ____moduleCache[file] then
        return ____moduleCache[file]
    end
    if ____modules[file] then
        ____moduleCache[file] = ____modules[file]()
        return ____moduleCache[file]
    else
        if ____originalRequire then
            return ____originalRequire(file)
        else
            error("module '" .. file .. "' not found")
        end
    end
end
____modules = {
["lualib_bundle"] = function() function __TS__ArrayConcat(arr1, ...)
    local args = {...}
    local out = {}
    for ____, val in ipairs(arr1) do
        out[#out + 1] = val
    end
    for ____, arg in ipairs(args) do
        if pcall(
            function() return #arg end
        ) and (type(arg) ~= "string") then
            local argAsArray = arg
            for ____, val in ipairs(argAsArray) do
                out[#out + 1] = val
            end
        else
            out[#out + 1] = arg
        end
    end
    return out
end

function __TS__ArrayEvery(arr, callbackfn)
    do
        local i = 0
        while i < #arr do
            if not callbackfn(_G, arr[i + 1], i, arr) then
                return false
            end
            i = i + 1
        end
    end
    return true
end

function __TS__ArrayFilter(arr, callbackfn)
    local result = {}
    do
        local i = 0
        while i < #arr do
            if callbackfn(_G, arr[i + 1], i, arr) then
                result[#result + 1] = arr[i + 1]
            end
            i = i + 1
        end
    end
    return result
end

function __TS__ArrayForEach(arr, callbackFn)
    do
        local i = 0
        while i < #arr do
            callbackFn(_G, arr[i + 1], i, arr)
            i = i + 1
        end
    end
end

function __TS__ArrayFind(arr, predicate)
    local len = #arr
    local k = 0
    while k < len do
        local elem = arr[k + 1]
        if predicate(_G, elem, k, arr) then
            return elem
        end
        k = k + 1
    end
    return nil
end

function __TS__ArrayFindIndex(arr, callbackFn)
    do
        local i = 0
        local len = #arr
        while i < len do
            if callbackFn(_G, arr[i + 1], i, arr) then
                return i
            end
            i = i + 1
        end
    end
    return -1
end

function __TS__ArrayIncludes(self, searchElement, fromIndex)
    if fromIndex == nil then
        fromIndex = 0
    end
    local len = #self
    local k = fromIndex
    if fromIndex < 0 then
        k = len + fromIndex
    end
    if k < 0 then
        k = 0
    end
    for i = k, len do
        if self[i + 1] == searchElement then
            return true
        end
    end
    return false
end

function __TS__ArrayIndexOf(arr, searchElement, fromIndex)
    local len = #arr
    if len == 0 then
        return -1
    end
    local n = 0
    if fromIndex then
        n = fromIndex
    end
    if n >= len then
        return -1
    end
    local k
    if n >= 0 then
        k = n
    else
        k = len + n
        if k < 0 then
            k = 0
        end
    end
    do
        local i = k
        while i < len do
            if arr[i + 1] == searchElement then
                return i
            end
            i = i + 1
        end
    end
    return -1
end

function __TS__ArrayJoin(self, separator)
    if separator == nil then
        separator = ","
    end
    local result = ""
    for index, value in ipairs(self) do
        if index > 1 then
            result = tostring(result) .. tostring(separator)
        end
        result = tostring(result) .. tostring(
            tostring(value)
        )
    end
    return result
end

function __TS__ArrayMap(arr, callbackfn)
    local newArray = {}
    do
        local i = 0
        while i < #arr do
            newArray[i + 1] = callbackfn(_G, arr[i + 1], i, arr)
            i = i + 1
        end
    end
    return newArray
end

function __TS__ArrayPush(arr, ...)
    local items = {...}
    for ____, item in ipairs(items) do
        arr[#arr + 1] = item
    end
    return #arr
end

function __TS__ArrayReduce(arr, callbackFn, ...)
    local len = #arr
    local k = 0
    local accumulator = nil
    if select("#", ...) ~= 0 then
        accumulator = select(1, ...)
    elseif len > 0 then
        accumulator = arr[1]
        k = 1
    else
        error("Reduce of empty array with no initial value", 0)
    end
    for i = k, len - 1 do
        accumulator = callbackFn(_G, accumulator, arr[i + 1], i, arr)
    end
    return accumulator
end

function __TS__ArrayReduceRight(arr, callbackFn, ...)
    local len = #arr
    local k = len - 1
    local accumulator = nil
    if select("#", ...) ~= 0 then
        accumulator = select(1, ...)
    elseif len > 0 then
        accumulator = arr[k + 1]
        k = k - 1
    else
        error("Reduce of empty array with no initial value", 0)
    end
    for i = k, 0, -1 do
        accumulator = callbackFn(_G, accumulator, arr[i + 1], i, arr)
    end
    return accumulator
end

function __TS__ArrayReverse(arr)
    local i = 0
    local j = #arr - 1
    while i < j do
        local temp = arr[j + 1]
        arr[j + 1] = arr[i + 1]
        arr[i + 1] = temp
        i = i + 1
        j = j - 1
    end
    return arr
end

function __TS__ArrayShift(arr)
    return table.remove(arr, 1)
end

function __TS__ArrayUnshift(arr, ...)
    local items = {...}
    do
        local i = #items - 1
        while i >= 0 do
            table.insert(arr, 1, items[i + 1])
            i = i - 1
        end
    end
    return #arr
end

function __TS__ArraySort(arr, compareFn)
    if compareFn ~= nil then
        table.sort(
            arr,
            function(a, b) return compareFn(_G, a, b) < 0 end
        )
    else
        table.sort(arr)
    end
    return arr
end

function __TS__ArraySlice(list, first, last)
    local len = #list
    local relativeStart = first or 0
    local k
    if relativeStart < 0 then
        k = math.max(len + relativeStart, 0)
    else
        k = math.min(relativeStart, len)
    end
    local relativeEnd = last
    if last == nil then
        relativeEnd = len
    end
    local final
    if relativeEnd < 0 then
        final = math.max(len + relativeEnd, 0)
    else
        final = math.min(relativeEnd, len)
    end
    local out = {}
    local n = 0
    while k < final do
        out[n + 1] = list[k + 1]
        k = k + 1
        n = n + 1
    end
    return out
end

function __TS__ArraySome(arr, callbackfn)
    do
        local i = 0
        while i < #arr do
            if callbackfn(_G, arr[i + 1], i, arr) then
                return true
            end
            i = i + 1
        end
    end
    return false
end

function __TS__ArraySplice(list, ...)
    local len = #list
    local actualArgumentCount = select("#", ...)
    local start = select(1, ...)
    local deleteCount = select(2, ...)
    local actualStart
    if start < 0 then
        actualStart = math.max(len + start, 0)
    else
        actualStart = math.min(start, len)
    end
    local itemCount = math.max(actualArgumentCount - 2, 0)
    local actualDeleteCount
    if actualArgumentCount == 0 then
        actualDeleteCount = 0
    elseif actualArgumentCount == 1 then
        actualDeleteCount = len - actualStart
    else
        actualDeleteCount = math.min(
            math.max(deleteCount or 0, 0),
            len - actualStart
        )
    end
    local out = {}
    do
        local k = 0
        while k < actualDeleteCount do
            local from = actualStart + k
            if list[from + 1] then
                out[k + 1] = list[from + 1]
            end
            k = k + 1
        end
    end
    if itemCount < actualDeleteCount then
        do
            local k = actualStart
            while k < (len - actualDeleteCount) do
                local from = k + actualDeleteCount
                local to = k + itemCount
                if list[from + 1] then
                    list[to + 1] = list[from + 1]
                else
                    list[to + 1] = nil
                end
                k = k + 1
            end
        end
        do
            local k = len
            while k > ((len - actualDeleteCount) + itemCount) do
                list[k] = nil
                k = k - 1
            end
        end
    elseif itemCount > actualDeleteCount then
        do
            local k = len - actualDeleteCount
            while k > actualStart do
                local from = (k + actualDeleteCount) - 1
                local to = (k + itemCount) - 1
                if list[from + 1] then
                    list[to + 1] = list[from + 1]
                else
                    list[to + 1] = nil
                end
                k = k - 1
            end
        end
    end
    local j = actualStart
    for i = 3, actualArgumentCount do
        list[j + 1] = select(i, ...)
        j = j + 1
    end
    do
        local k = #list - 1
        while k >= ((len - actualDeleteCount) + itemCount) do
            list[k + 1] = nil
            k = k - 1
        end
    end
    return out
end

function __TS__ArrayToObject(array)
    local object = {}
    do
        local i = 0
        while i < #array do
            object[i] = array[i + 1]
            i = i + 1
        end
    end
    return object
end

function __TS__ArrayFlat(array, depth)
    if depth == nil then
        depth = 1
    end
    local result = {}
    for ____, value in ipairs(array) do
        if ((depth > 0) and (type(value) == "table")) and ((value[1] ~= nil) or (next(value, nil) == nil)) then
            result = __TS__ArrayConcat(
                result,
                __TS__ArrayFlat(value, depth - 1)
            )
        else
            result[#result + 1] = value
        end
    end
    return result
end

function __TS__ArrayFlatMap(array, callback)
    local result = {}
    do
        local i = 0
        while i < #array do
            local value = callback(_G, array[i + 1], i, array)
            if (type(value) == "table") and ((value[1] ~= nil) or (next(value, nil) == nil)) then
                result = __TS__ArrayConcat(result, value)
            else
                result[#result + 1] = value
            end
            i = i + 1
        end
    end
    return result
end

function __TS__ArraySetLength(arr, length)
    if (((length < 0) or (length ~= length)) or (length == math.huge)) or (math.floor(length) ~= length) then
        error(
            "invalid array length: " .. tostring(length),
            0
        )
    end
    do
        local i = #arr - 1
        while i >= length do
            arr[i + 1] = nil
            i = i - 1
        end
    end
    return length
end

function __TS__Class(self)
    local c = {prototype = {}}
    c.prototype.__index = c.prototype
    c.prototype.constructor = c
    return c
end

function __TS__ClassExtends(target, base)
    target.____super = base
    local staticMetatable = setmetatable({__index = base}, base)
    setmetatable(target, staticMetatable)
    local baseMetatable = getmetatable(base)
    if baseMetatable then
        if type(baseMetatable.__index) == "function" then
            staticMetatable.__index = baseMetatable.__index
        end
        if type(baseMetatable.__newindex) == "function" then
            staticMetatable.__newindex = baseMetatable.__newindex
        end
    end
    setmetatable(target.prototype, base.prototype)
    if type(base.prototype.__index) == "function" then
        target.prototype.__index = base.prototype.__index
    end
    if type(base.prototype.__newindex) == "function" then
        target.prototype.__newindex = base.prototype.__newindex
    end
    if type(base.prototype.__tostring) == "function" then
        target.prototype.__tostring = base.prototype.__tostring
    end
end

function __TS__CloneDescriptor(____bindingPattern0)
    local enumerable
    enumerable = ____bindingPattern0.enumerable
    local configurable
    configurable = ____bindingPattern0.configurable
    local get
    get = ____bindingPattern0.get
    local set
    set = ____bindingPattern0.set
    local writable
    writable = ____bindingPattern0.writable
    local value
    value = ____bindingPattern0.value
    local descriptor = {enumerable = enumerable == true, configurable = configurable == true}
    local hasGetterOrSetter = (get ~= nil) or (set ~= nil)
    local hasValueOrWritableAttribute = (writable ~= nil) or (value ~= nil)
    if hasGetterOrSetter and hasValueOrWritableAttribute then
        error("Invalid property descriptor. Cannot both specify accessors and a value or writable attribute.", 0)
    end
    if get or set then
        descriptor.get = get
        descriptor.set = set
    else
        descriptor.value = value
        descriptor.writable = writable == true
    end
    return descriptor
end

function __TS__Decorate(decorators, target, key, desc)
    local result = target
    do
        local i = #decorators
        while i >= 0 do
            local decorator = decorators[i + 1]
            if decorator then
                local oldResult = result
                if key == nil then
                    result = decorator(_G, result)
                elseif desc == true then
                    local value = rawget(target, key)
                    local descriptor = __TS__ObjectGetOwnPropertyDescriptor(target, key) or ({configurable = true, writable = true, value = value})
                    local desc = decorator(_G, target, key, descriptor) or descriptor
                    local isSimpleValue = (((desc.configurable == true) and (desc.writable == true)) and (not desc.get)) and (not desc.set)
                    if isSimpleValue then
                        rawset(target, key, desc.value)
                    else
                        __TS__SetDescriptor(
                            target,
                            key,
                            __TS__ObjectAssign({}, descriptor, desc)
                        )
                    end
                elseif desc == false then
                    result = decorator(_G, target, key, desc)
                else
                    result = decorator(_G, target, key)
                end
                result = result or oldResult
            end
            i = i - 1
        end
    end
    return result
end

function __TS__DecorateParam(paramIndex, decorator)
    return function(____, target, key) return decorator(_G, target, key, paramIndex) end
end

function __TS__ObjectGetOwnPropertyDescriptors(object)
    local metatable = getmetatable(object)
    if not metatable then
        return {}
    end
    return rawget(metatable, "_descriptors")
end

function __TS__Delete(target, key)
    local descriptors = __TS__ObjectGetOwnPropertyDescriptors(target)
    local descriptor = descriptors[key]
    if descriptor then
        if not descriptor.configurable then
            error(
                ((("Cannot delete property " .. tostring(key)) .. " of ") .. tostring(target)) .. ".",
                0
            )
        end
        descriptors[key] = nil
        return true
    end
    if target[key] ~= nil then
        target[key] = nil
        return true
    end
    return false
end

function __TS__DelegatedYield(iterable)
    if type(iterable) == "string" then
        for index = 0, #iterable - 1 do
            coroutine.yield(
                __TS__StringAccess(iterable, index)
            )
        end
    elseif iterable.____coroutine ~= nil then
        local co = iterable.____coroutine
        while true do
            local status, value = coroutine.resume(co)
            if not status then
                error(value, 0)
            end
            if coroutine.status(co) == "dead" then
                return value
            else
                coroutine.yield(value)
            end
        end
    elseif iterable[Symbol.iterator] then
        local iterator = iterable[Symbol.iterator](iterable)
        while true do
            local result = iterator:next()
            if result.done then
                return result.value
            else
                coroutine.yield(result.value)
            end
        end
    else
        for ____, value in ipairs(iterable) do
            coroutine.yield(value)
        end
    end
end

function __TS__New(target, ...)
    local instance = setmetatable({}, target.prototype)
    instance:____constructor(...)
    return instance
end

function __TS__GetErrorStack(self, constructor)
    local level = 1
    while true do
        local info = debug.getinfo(level, "f")
        level = level + 1
        if not info then
            level = 1
            break
        elseif info.func == constructor then
            break
        end
    end
    return debug.traceback(nil, level)
end
function __TS__WrapErrorToString(self, getDescription)
    return function(self)
        local description = getDescription(self)
        local caller = debug.getinfo(3, "f")
        if (_VERSION == "Lua 5.1") or (caller and (caller.func ~= error)) then
            return description
        else
            return (tostring(description) .. "\n") .. tostring(self.stack)
        end
    end
end
function __TS__InitErrorClass(self, Type, name)
    Type.name = name
    return setmetatable(
        Type,
        {
            __call = function(____, _self, message) return __TS__New(Type, message) end
        }
    )
end
Error = __TS__InitErrorClass(
    _G,
    (function()
        local ____ = __TS__Class()
        ____.name = ""
        function ____.prototype.____constructor(self, message)
            if message == nil then
                message = ""
            end
            self.message = message
            self.name = "Error"
            self.stack = __TS__GetErrorStack(_G, self.constructor.new)
            local metatable = getmetatable(self)
            if not metatable.__errorToStringPatched then
                metatable.__errorToStringPatched = true
                metatable.__tostring = __TS__WrapErrorToString(_G, metatable.__tostring)
            end
        end
        function ____.prototype.__tostring(self)
            return (((self.message ~= "") and (function() return (tostring(self.name) .. ": ") .. tostring(self.message) end)) or (function() return self.name end))()
        end
        return ____
    end)(),
    "Error"
)
for ____, errorName in ipairs({"RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError"}) do
    _G[errorName] = __TS__InitErrorClass(
        _G,
        (function()
            local ____ = __TS__Class()
            ____.name = ____.name
            __TS__ClassExtends(____, Error)
            function ____.prototype.____constructor(self, ...)
                Error.prototype.____constructor(self, ...)
                self.name = errorName
            end
            return ____
        end)(),
        errorName
    )
end

__TS__Unpack = table.unpack or unpack

function __TS__FunctionBind(fn, thisArg, ...)
    local boundArgs = {...}
    return function(____, ...)
        local args = {...}
        do
            local i = 0
            while i < #boundArgs do
                table.insert(args, i + 1, boundArgs[i + 1])
                i = i + 1
            end
        end
        return fn(
            thisArg,
            __TS__Unpack(args)
        )
    end
end

____symbolMetatable = {
    __tostring = function(self)
        return ("Symbol(" .. tostring(self.description or "")) .. ")"
    end
}
function __TS__Symbol(description)
    return setmetatable({description = description}, ____symbolMetatable)
end
Symbol = {
    iterator = __TS__Symbol("Symbol.iterator"),
    hasInstance = __TS__Symbol("Symbol.hasInstance"),
    species = __TS__Symbol("Symbol.species"),
    toStringTag = __TS__Symbol("Symbol.toStringTag")
}

function __TS__GeneratorIterator(self)
    return self
end
function __TS__GeneratorNext(self, ...)
    local co = self.____coroutine
    if coroutine.status(co) == "dead" then
        return {done = true}
    end
    local status, value = coroutine.resume(co, ...)
    if not status then
        error(value, 0)
    end
    return {
        value = value,
        done = coroutine.status(co) == "dead"
    }
end
function __TS__Generator(fn)
    return function(...)
        local args = {...}
        local argsLength = select("#", ...)
        return {
            ____coroutine = coroutine.create(
                function() return fn(
                    (unpack or table.unpack)(args, 1, argsLength)
                ) end
            ),
            [Symbol.iterator] = __TS__GeneratorIterator,
            next = __TS__GeneratorNext
        }
    end
end

function __TS__InstanceOf(obj, classTbl)
    if type(classTbl) ~= "table" then
        error("Right-hand side of 'instanceof' is not an object", 0)
    end
    if classTbl[Symbol.hasInstance] ~= nil then
        return not (not classTbl[Symbol.hasInstance](classTbl, obj))
    end
    if type(obj) == "table" then
        local luaClass = obj.constructor
        while luaClass ~= nil do
            if luaClass == classTbl then
                return true
            end
            luaClass = luaClass.____super
        end
    end
    return false
end

function __TS__InstanceOfObject(value)
    local valueType = type(value)
    return (valueType == "table") or (valueType == "function")
end

function __TS__IteratorGeneratorStep(self)
    local co = self.____coroutine
    local status, value = coroutine.resume(co)
    if not status then
        error(value, 0)
    end
    if coroutine.status(co) == "dead" then
        return
    end
    return true, value
end
function __TS__IteratorIteratorStep(self)
    local result = self:next()
    if result.done then
        return
    end
    return true, result.value
end
function __TS__IteratorStringStep(self, index)
    index = index + 1
    if index > #self then
        return
    end
    return index, string.sub(self, index, index)
end
function __TS__Iterator(iterable)
    if type(iterable) == "string" then
        return __TS__IteratorStringStep, iterable, 0
    elseif iterable.____coroutine ~= nil then
        return __TS__IteratorGeneratorStep, iterable
    elseif iterable[Symbol.iterator] then
        local iterator = iterable[Symbol.iterator](iterable)
        return __TS__IteratorIteratorStep, iterator
    else
        return ipairs(iterable)
    end
end

Map = (function()
    local Map = __TS__Class()
    Map.name = "Map"
    function Map.prototype.____constructor(self, entries)
        self[Symbol.toStringTag] = "Map"
        self.items = {}
        self.size = 0
        self.nextKey = {}
        self.previousKey = {}
        if entries == nil then
            return
        end
        local iterable = entries
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                local value = result.value
                self:set(value[1], value[2])
            end
        else
            local array = entries
            for ____, kvp in ipairs(array) do
                self:set(kvp[1], kvp[2])
            end
        end
    end
    function Map.prototype.clear(self)
        self.items = {}
        self.nextKey = {}
        self.previousKey = {}
        self.firstKey = nil
        self.lastKey = nil
        self.size = 0
    end
    function Map.prototype.delete(self, key)
        local contains = self:has(key)
        if contains then
            self.size = self.size - 1
            local next = self.nextKey[key]
            local previous = self.previousKey[key]
            if next and previous then
                self.nextKey[previous] = next
                self.previousKey[next] = previous
            elseif next then
                self.firstKey = next
                self.previousKey[next] = nil
            elseif previous then
                self.lastKey = previous
                self.nextKey[previous] = nil
            else
                self.firstKey = nil
                self.lastKey = nil
            end
            self.nextKey[key] = nil
            self.previousKey[key] = nil
        end
        self.items[key] = nil
        return contains
    end
    function Map.prototype.forEach(self, callback)
        for ____, key in __TS__Iterator(
            self:keys()
        ) do
            callback(_G, self.items[key], key, self)
        end
    end
    function Map.prototype.get(self, key)
        return self.items[key]
    end
    function Map.prototype.has(self, key)
        return (self.nextKey[key] ~= nil) or (self.lastKey == key)
    end
    function Map.prototype.set(self, key, value)
        local isNewValue = not self:has(key)
        if isNewValue then
            self.size = self.size + 1
        end
        self.items[key] = value
        if self.firstKey == nil then
            self.firstKey = key
            self.lastKey = key
        elseif isNewValue then
            self.nextKey[self.lastKey] = key
            self.previousKey[key] = self.lastKey
            self.lastKey = key
        end
        return self
    end
    Map.prototype[Symbol.iterator] = function(self)
        return self:entries()
    end
    function Map.prototype.entries(self)
        local ____ = self
        local items = ____.items
        local nextKey = ____.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = {key, items[key]}}
                key = nextKey[key]
                return result
            end
        }
    end
    function Map.prototype.keys(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = key}
                key = nextKey[key]
                return result
            end
        }
    end
    function Map.prototype.values(self)
        local ____ = self
        local items = ____.items
        local nextKey = ____.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = items[key]}
                key = nextKey[key]
                return result
            end
        }
    end
    Map[Symbol.species] = Map
    return Map
end)()

__TS__MathAtan2 = math.atan2 or math.atan

function __TS__Number(value)
    local valueType = type(value)
    if valueType == "number" then
        return value
    elseif valueType == "string" then
        local numberValue = tonumber(value)
        if numberValue then
            return numberValue
        end
        if value == "Infinity" then
            return math.huge
        end
        if value == "-Infinity" then
            return -math.huge
        end
        local stringWithoutSpaces = string.gsub(value, "%s", "")
        if stringWithoutSpaces == "" then
            return 0
        end
        return 0 / 0
    elseif valueType == "boolean" then
        return (value and 1) or 0
    else
        return 0 / 0
    end
end

function __TS__NumberIsFinite(value)
    return (((type(value) == "number") and (value == value)) and (value ~= math.huge)) and (value ~= -math.huge)
end

function __TS__NumberIsNaN(value)
    return value ~= value
end

____radixChars = "0123456789abcdefghijklmnopqrstuvwxyz"
function __TS__NumberToString(self, radix)
    if ((((radix == nil) or (radix == 10)) or (self == math.huge)) or (self == -math.huge)) or (self ~= self) then
        return tostring(self)
    end
    radix = math.floor(radix)
    if (radix < 2) or (radix > 36) then
        error("toString() radix argument must be between 2 and 36", 0)
    end
    local integer, fraction = math.modf(
        math.abs(self)
    )
    local result = ""
    if radix == 8 then
        result = string.format("%o", integer)
    elseif radix == 16 then
        result = string.format("%x", integer)
    else
        repeat
            do
                result = tostring(
                    __TS__StringAccess(____radixChars, integer % radix)
                ) .. tostring(result)
                integer = math.floor(integer / radix)
            end
        until not (integer ~= 0)
    end
    if fraction ~= 0 then
        result = tostring(result) .. "."
        local delta = 1e-16
        repeat
            do
                fraction = fraction * radix
                delta = delta * radix
                local digit = math.floor(fraction)
                result = tostring(result) .. tostring(
                    __TS__StringAccess(____radixChars, digit)
                )
                fraction = fraction - digit
            end
        until not (fraction >= delta)
    end
    if self < 0 then
        result = "-" .. tostring(result)
    end
    return result
end

function __TS__ObjectAssign(to, ...)
    local sources = {...}
    if to == nil then
        return to
    end
    for ____, source in ipairs(sources) do
        for key in pairs(source) do
            to[key] = source[key]
        end
    end
    return to
end

function ____descriptorIndex(self, key)
    local value = rawget(self, key)
    if value ~= nil then
        return value
    end
    local metatable = getmetatable(self)
    while metatable do
        local rawResult = rawget(metatable, key)
        if rawResult ~= nil then
            return rawResult
        end
        local descriptors = rawget(metatable, "_descriptors")
        if descriptors then
            local descriptor = descriptors[key]
            if descriptor then
                if descriptor.get then
                    return descriptor.get(self)
                end
                return descriptor.value
            end
        end
        metatable = getmetatable(metatable)
    end
end
function ____descriptorNewindex(self, key, value)
    local metatable = getmetatable(self)
    while metatable do
        local descriptors = rawget(metatable, "_descriptors")
        if descriptors then
            local descriptor = descriptors[key]
            if descriptor then
                if descriptor.set then
                    descriptor.set(self, value)
                else
                    if descriptor.writable == false then
                        error(
                            ((("Cannot assign to read only property '" .. tostring(key)) .. "' of object '") .. tostring(self)) .. "'",
                            0
                        )
                    end
                    descriptor.value = value
                end
                return
            end
        end
        metatable = getmetatable(metatable)
    end
    rawset(self, key, value)
end
function __TS__SetDescriptor(target, key, desc, isPrototype)
    if isPrototype == nil then
        isPrototype = false
    end
    local metatable = ((isPrototype and (function() return target end)) or (function() return getmetatable(target) end))()
    if not metatable then
        metatable = {}
        setmetatable(target, metatable)
    end
    local value = rawget(target, key)
    if value ~= nil then
        rawset(target, key, nil)
    end
    if not rawget(metatable, "_descriptors") then
        metatable._descriptors = {}
    end
    local descriptor = __TS__CloneDescriptor(desc)
    metatable._descriptors[key] = descriptor
    metatable.__index = ____descriptorIndex
    metatable.__newindex = ____descriptorNewindex
end

function __TS__ObjectDefineProperty(target, key, desc)
    local luaKey = (((type(key) == "number") and (function() return key + 1 end)) or (function() return key end))()
    local value = rawget(target, luaKey)
    local hasGetterOrSetter = (desc.get ~= nil) or (desc.set ~= nil)
    local descriptor
    if hasGetterOrSetter then
        if value ~= nil then
            error(
                "Cannot redefine property: " .. tostring(key),
                0
            )
        end
        descriptor = desc
    else
        local valueExists = value ~= nil
        descriptor = {
            set = desc.set,
            get = desc.get,
            configurable = (((desc.configurable ~= nil) and (function() return desc.configurable end)) or (function() return valueExists end))(),
            enumerable = (((desc.enumerable ~= nil) and (function() return desc.enumerable end)) or (function() return valueExists end))(),
            writable = (((desc.writable ~= nil) and (function() return desc.writable end)) or (function() return valueExists end))(),
            value = (((desc.value ~= nil) and (function() return desc.value end)) or (function() return value end))()
        }
    end
    __TS__SetDescriptor(target, luaKey, descriptor)
    return target
end

function __TS__ObjectEntries(obj)
    local result = {}
    for key in pairs(obj) do
        result[#result + 1] = {key, obj[key]}
    end
    return result
end

function __TS__ObjectFromEntries(entries)
    local obj = {}
    local iterable = entries
    if iterable[Symbol.iterator] then
        local iterator = iterable[Symbol.iterator](iterable)
        while true do
            local result = iterator:next()
            if result.done then
                break
            end
            local value = result.value
            obj[value[1]] = value[2]
        end
    else
        for ____, entry in ipairs(entries) do
            obj[entry[1]] = entry[2]
        end
    end
    return obj
end

function __TS__ObjectGetOwnPropertyDescriptor(object, key)
    local metatable = getmetatable(object)
    if not metatable then
        return
    end
    if not rawget(metatable, "_descriptors") then
        return
    end
    return rawget(metatable, "_descriptors")[key]
end

function __TS__ObjectKeys(obj)
    local result = {}
    for key in pairs(obj) do
        result[#result + 1] = key
    end
    return result
end

function __TS__ObjectRest(target, usedProperties)
    local result = {}
    for property in pairs(target) do
        if not usedProperties[property] then
            result[property] = target[property]
        end
    end
    return result
end

function __TS__ObjectValues(obj)
    local result = {}
    for key in pairs(obj) do
        result[#result + 1] = obj[key]
    end
    return result
end

function __TS__ParseFloat(numberString)
    local infinityMatch = string.match(numberString, "^%s*(-?Infinity)")
    if infinityMatch then
        return (((__TS__StringAccess(infinityMatch, 0) == "-") and (function() return -math.huge end)) or (function() return math.huge end))()
    end
    local number = tonumber(
        string.match(numberString, "^%s*(-?%d+%.?%d*)")
    )
    return number or (0 / 0)
end

__TS__parseInt_base_pattern = "0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTvVwWxXyYzZ"
function __TS__ParseInt(numberString, base)
    if base == nil then
        base = 10
        local hexMatch = string.match(numberString, "^%s*-?0[xX]")
        if hexMatch then
            base = 16
            numberString = ((string.match(hexMatch, "-") and (function() return "-" .. tostring(
                __TS__StringSubstr(numberString, #hexMatch)
            ) end)) or (function() return __TS__StringSubstr(numberString, #hexMatch) end))()
        end
    end
    if (base < 2) or (base > 36) then
        return 0 / 0
    end
    local allowedDigits = (((base <= 10) and (function() return __TS__StringSubstring(__TS__parseInt_base_pattern, 0, base) end)) or (function() return __TS__StringSubstr(__TS__parseInt_base_pattern, 0, 10 + (2 * (base - 10))) end))()
    local pattern = ("^%s*(-?[" .. tostring(allowedDigits)) .. "]*)"
    local number = tonumber(
        string.match(numberString, pattern),
        base
    )
    if number == nil then
        return 0 / 0
    end
    if number >= 0 then
        return math.floor(number)
    else
        return math.ceil(number)
    end
end

Set = (function()
    local Set = __TS__Class()
    Set.name = "Set"
    function Set.prototype.____constructor(self, values)
        self[Symbol.toStringTag] = "Set"
        self.size = 0
        self.nextKey = {}
        self.previousKey = {}
        if values == nil then
            return
        end
        local iterable = values
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                self:add(result.value)
            end
        else
            local array = values
            for ____, value in ipairs(array) do
                self:add(value)
            end
        end
    end
    function Set.prototype.add(self, value)
        local isNewValue = not self:has(value)
        if isNewValue then
            self.size = self.size + 1
        end
        if self.firstKey == nil then
            self.firstKey = value
            self.lastKey = value
        elseif isNewValue then
            self.nextKey[self.lastKey] = value
            self.previousKey[value] = self.lastKey
            self.lastKey = value
        end
        return self
    end
    function Set.prototype.clear(self)
        self.nextKey = {}
        self.previousKey = {}
        self.firstKey = nil
        self.lastKey = nil
        self.size = 0
    end
    function Set.prototype.delete(self, value)
        local contains = self:has(value)
        if contains then
            self.size = self.size - 1
            local next = self.nextKey[value]
            local previous = self.previousKey[value]
            if next and previous then
                self.nextKey[previous] = next
                self.previousKey[next] = previous
            elseif next then
                self.firstKey = next
                self.previousKey[next] = nil
            elseif previous then
                self.lastKey = previous
                self.nextKey[previous] = nil
            else
                self.firstKey = nil
                self.lastKey = nil
            end
            self.nextKey[value] = nil
            self.previousKey[value] = nil
        end
        return contains
    end
    function Set.prototype.forEach(self, callback)
        for ____, key in __TS__Iterator(
            self:keys()
        ) do
            callback(_G, key, key, self)
        end
    end
    function Set.prototype.has(self, value)
        return (self.nextKey[value] ~= nil) or (self.lastKey == value)
    end
    Set.prototype[Symbol.iterator] = function(self)
        return self:values()
    end
    function Set.prototype.entries(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = {key, key}}
                key = nextKey[key]
                return result
            end
        }
    end
    function Set.prototype.keys(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = key}
                key = nextKey[key]
                return result
            end
        }
    end
    function Set.prototype.values(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = key}
                key = nextKey[key]
                return result
            end
        }
    end
    Set[Symbol.species] = Set
    return Set
end)()

WeakMap = (function()
    local WeakMap = __TS__Class()
    WeakMap.name = "WeakMap"
    function WeakMap.prototype.____constructor(self, entries)
        self[Symbol.toStringTag] = "WeakMap"
        self.items = {}
        setmetatable(self.items, {__mode = "k"})
        if entries == nil then
            return
        end
        local iterable = entries
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                local value = result.value
                self.items[value[1]] = value[2]
            end
        else
            for ____, kvp in ipairs(entries) do
                self.items[kvp[1]] = kvp[2]
            end
        end
    end
    function WeakMap.prototype.delete(self, key)
        local contains = self:has(key)
        self.items[key] = nil
        return contains
    end
    function WeakMap.prototype.get(self, key)
        return self.items[key]
    end
    function WeakMap.prototype.has(self, key)
        return self.items[key] ~= nil
    end
    function WeakMap.prototype.set(self, key, value)
        self.items[key] = value
        return self
    end
    WeakMap[Symbol.species] = WeakMap
    return WeakMap
end)()

WeakSet = (function()
    local WeakSet = __TS__Class()
    WeakSet.name = "WeakSet"
    function WeakSet.prototype.____constructor(self, values)
        self[Symbol.toStringTag] = "WeakSet"
        self.items = {}
        setmetatable(self.items, {__mode = "k"})
        if values == nil then
            return
        end
        local iterable = values
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                self.items[result.value] = true
            end
        else
            for ____, value in ipairs(values) do
                self.items[value] = true
            end
        end
    end
    function WeakSet.prototype.add(self, value)
        self.items[value] = true
        return self
    end
    function WeakSet.prototype.delete(self, value)
        local contains = self:has(value)
        self.items[value] = nil
        return contains
    end
    function WeakSet.prototype.has(self, value)
        return self.items[value] == true
    end
    WeakSet[Symbol.species] = WeakSet
    return WeakSet
end)()

function __TS__SourceMapTraceBack(fileName, sourceMap)
    _G.__TS__sourcemap = _G.__TS__sourcemap or ({})
    _G.__TS__sourcemap[fileName] = sourceMap
    if _G.__TS__originalTraceback == nil then
        _G.__TS__originalTraceback = debug.traceback
        debug.traceback = function(thread, message, level)
            local trace
            if ((thread == nil) and (message == nil)) and (level == nil) then
                trace = _G.__TS__originalTraceback()
            else
                trace = _G.__TS__originalTraceback(thread, message, level)
            end
            if type(trace) ~= "string" then
                return trace
            end
            local result = string.gsub(
                trace,
                "(%S+).lua:(%d+)",
                function(file, line)
                    local fileSourceMap = _G.__TS__sourcemap[tostring(file) .. ".lua"]
                    if fileSourceMap and fileSourceMap[line] then
                        return (tostring(file) .. ".ts:") .. tostring(fileSourceMap[line])
                    end
                    return (tostring(file) .. ".lua:") .. tostring(line)
                end
            )
            return result
        end
    end
end

function __TS__Spread(iterable)
    local arr = {}
    if type(iterable) == "string" then
        do
            local i = 0
            while i < #iterable do
                arr[#arr + 1] = __TS__StringAccess(iterable, i)
                i = i + 1
            end
        end
    else
        for ____, item in __TS__Iterator(iterable) do
            arr[#arr + 1] = item
        end
    end
    return __TS__Unpack(arr)
end

function __TS__StringAccess(self, index)
    if (index >= 0) and (index < #self) then
        return string.sub(self, index + 1, index + 1)
    end
end

function __TS__StringCharAt(self, pos)
    if pos ~= pos then
        pos = 0
    end
    if pos < 0 then
        return ""
    end
    return string.sub(self, pos + 1, pos + 1)
end

function __TS__StringCharCodeAt(self, index)
    if index ~= index then
        index = 0
    end
    if index < 0 then
        return 0 / 0
    end
    return string.byte(self, index + 1) or (0 / 0)
end

function __TS__StringConcat(str1, ...)
    local args = {...}
    local out = str1
    for ____, arg in ipairs(args) do
        out = tostring(out) .. tostring(arg)
    end
    return out
end

function __TS__StringEndsWith(self, searchString, endPosition)
    if (endPosition == nil) or (endPosition > #self) then
        endPosition = #self
    end
    return string.sub(self, (endPosition - #searchString) + 1, endPosition) == searchString
end

function __TS__StringPadEnd(self, maxLength, fillString)
    if fillString == nil then
        fillString = " "
    end
    if maxLength ~= maxLength then
        maxLength = 0
    end
    if (maxLength == -math.huge) or (maxLength == math.huge) then
        error("Invalid string length", 0)
    end
    if (#self >= maxLength) or (#fillString == 0) then
        return self
    end
    maxLength = maxLength - #self
    if maxLength > #fillString then
        fillString = tostring(fillString) .. tostring(
            string.rep(
                fillString,
                math.floor(maxLength / #fillString)
            )
        )
    end
    return tostring(self) .. tostring(
        string.sub(
            fillString,
            1,
            math.floor(maxLength)
        )
    )
end

function __TS__StringPadStart(self, maxLength, fillString)
    if fillString == nil then
        fillString = " "
    end
    if maxLength ~= maxLength then
        maxLength = 0
    end
    if (maxLength == -math.huge) or (maxLength == math.huge) then
        error("Invalid string length", 0)
    end
    if (#self >= maxLength) or (#fillString == 0) then
        return self
    end
    maxLength = maxLength - #self
    if maxLength > #fillString then
        fillString = tostring(fillString) .. tostring(
            string.rep(
                fillString,
                math.floor(maxLength / #fillString)
            )
        )
    end
    return tostring(
        string.sub(
            fillString,
            1,
            math.floor(maxLength)
        )
    ) .. tostring(self)
end

function __TS__StringReplace(source, searchValue, replaceValue)
    searchValue = string.gsub(searchValue, "[%%%(%)%.%+%-%*%?%[%^%$]", "%%%1")
    if type(replaceValue) == "string" then
        replaceValue = string.gsub(replaceValue, "%%", "%%%%")
        local result = string.gsub(source, searchValue, replaceValue, 1)
        return result
    else
        local result = string.gsub(
            source,
            searchValue,
            function(match) return replaceValue(_G, match) end,
            1
        )
        return result
    end
end

function __TS__StringSlice(self, start, ____end)
    if (start == nil) or (start ~= start) then
        start = 0
    end
    if ____end ~= ____end then
        ____end = 0
    end
    if start >= 0 then
        start = start + 1
    end
    if (____end ~= nil) and (____end < 0) then
        ____end = ____end - 1
    end
    return string.sub(self, start, ____end)
end

function __TS__StringSplit(source, separator, limit)
    if limit == nil then
        limit = 4294967295
    end
    if limit == 0 then
        return {}
    end
    local out = {}
    local index = 0
    local count = 0
    if (separator == nil) or (separator == "") then
        while (index < (#source - 1)) and (count < limit) do
            out[count + 1] = __TS__StringAccess(source, index)
            count = count + 1
            index = index + 1
        end
    else
        local separatorLength = #separator
        local nextIndex = (string.find(source, separator, nil, true) or 0) - 1
        while (nextIndex >= 0) and (count < limit) do
            out[count + 1] = __TS__StringSubstring(source, index, nextIndex)
            count = count + 1
            index = nextIndex + separatorLength
            nextIndex = (string.find(
                source,
                separator,
                math.max(index + 1, 1),
                true
            ) or 0) - 1
        end
    end
    if count < limit then
        out[count + 1] = __TS__StringSubstring(source, index)
    end
    return out
end

function __TS__StringStartsWith(self, searchString, position)
    if (position == nil) or (position < 0) then
        position = 0
    end
    return string.sub(self, position + 1, #searchString + position) == searchString
end

function __TS__StringSubstr(self, from, length)
    if from ~= from then
        from = 0
    end
    if length ~= nil then
        if (length ~= length) or (length <= 0) then
            return ""
        end
        length = length + from
    end
    if from >= 0 then
        from = from + 1
    end
    return string.sub(self, from, length)
end

function __TS__StringSubstring(self, start, ____end)
    if ____end ~= ____end then
        ____end = 0
    end
    if (____end ~= nil) and (start > ____end) then
        start, ____end = __TS__Unpack({____end, start})
    end
    if start >= 0 then
        start = start + 1
    else
        start = 1
    end
    if (____end ~= nil) and (____end < 0) then
        ____end = 0
    end
    return string.sub(self, start, ____end)
end

function __TS__StringTrim(self)
    local result = string.gsub(self, "^[%s ﻿]*(.-)[%s ﻿]*$", "%1")
    return result
end

function __TS__StringTrimEnd(self)
    local result = string.gsub(self, "[%s ﻿]*$", "")
    return result
end

function __TS__StringTrimStart(self)
    local result = string.gsub(self, "^[%s ﻿]*", "")
    return result
end

____symbolRegistry = {}
function __TS__SymbolRegistryFor(key)
    if not ____symbolRegistry[key] then
        ____symbolRegistry[key] = __TS__Symbol(key)
    end
    return ____symbolRegistry[key]
end
function __TS__SymbolRegistryKeyFor(sym)
    for key in pairs(____symbolRegistry) do
        if ____symbolRegistry[key] == sym then
            return key
        end
    end
end

function __TS__TypeOf(value)
    local luaType = type(value)
    if luaType == "table" then
        return "object"
    elseif luaType == "nil" then
        return "undefined"
    else
        return luaType
    end
end

end,
["node_modules.w3ts.handles.handle"] = function() require("lualib_bundle");
local ____exports = {}
local map = __TS__New(WeakMap)
____exports.Handle = __TS__Class()
local Handle = ____exports.Handle
Handle.name = "Handle"
function Handle.prototype.____constructor(self, handle)
    self.handle = (((handle == nil) and (function() return ____exports.Handle.initHandle end)) or (function() return handle end))()
    map:set(self.handle, self)
end
__TS__SetDescriptor(
    Handle.prototype,
    "id",
    {
        get = function(self)
            return GetHandleId(self.handle)
        end
    },
    true
)
function Handle.initFromHandle(self)
    return ____exports.Handle.initHandle ~= nil
end
function Handle.getObject(self, handle)
    local obj = map:get(handle)
    if obj ~= nil then
        return obj
    end
    ____exports.Handle.initHandle = handle
    local newObj = __TS__New(self)
    ____exports.Handle.initHandle = nil
    return newObj
end
return ____exports
end,
["node_modules.w3ts.handles.point"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Point = __TS__Class()
local Point = ____exports.Point
Point.name = "Point"
__TS__ClassExtends(Point, Handle)
function Point.prototype.____constructor(self, x, y)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            Location(x, y)
        )
    end
end
__TS__SetDescriptor(
    Point.prototype,
    "x",
    {
        get = function(self)
            return GetLocationX(self.handle)
        end,
        set = function(self, value)
            MoveLocation(self.handle, value, self.y)
        end
    },
    true
)
__TS__SetDescriptor(
    Point.prototype,
    "y",
    {
        get = function(self)
            return GetLocationY(self.handle)
        end,
        set = function(self, value)
            MoveLocation(self.handle, self.x, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Point.prototype,
    "z",
    {
        get = function(self)
            return GetLocationZ(self.handle)
        end
    },
    true
)
function Point.prototype.destroy(self)
    RemoveLocation(self.handle)
end
function Point.prototype.setPosition(self, x, y)
    MoveLocation(self.handle, x, y)
end
function Point.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.camera"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
local ____point = require("node_modules.w3ts.handles.point")
local Point = ____point.Point
____exports.Camera = __TS__Class()
local Camera = ____exports.Camera
Camera.name = "Camera"
function Camera.prototype.____constructor(self)
end
__TS__ObjectDefineProperty(
    Camera,
    "visible",
    {
        get = function(self)
            return IsCineFilterDisplayed()
        end,
        set = function(self, flag)
            DisplayCineFilter(flag)
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "boundMinX",
    {
        get = function(self)
            return GetCameraBoundMinX()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "boundMinY",
    {
        get = function(self)
            return GetCameraBoundMinY()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "boundMaxX",
    {
        get = function(self)
            return GetCameraBoundMaxX()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "boundMaxY",
    {
        get = function(self)
            return GetCameraBoundMaxY()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "targetX",
    {
        get = function(self)
            return GetCameraTargetPositionX()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "targetY",
    {
        get = function(self)
            return GetCameraTargetPositionY()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "targetZ",
    {
        get = function(self)
            return GetCameraTargetPositionZ()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "eyeX",
    {
        get = function(self)
            return GetCameraEyePositionX()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "eyeY",
    {
        get = function(self)
            return GetCameraEyePositionY()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "eyeZ",
    {
        get = function(self)
            return GetCameraEyePositionZ()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "eyePoint",
    {
        get = function(self)
            return GetCameraEyePositionLoc()
        end
    }
)
__TS__ObjectDefineProperty(
    Camera,
    "targetPoint",
    {
        get = function(self)
            return Point:fromHandle(
                GetCameraTargetPositionLoc()
            )
        end
    }
)
function Camera.adjustField(self, whichField, offset, duration)
    AdjustCameraField(whichField, offset, duration)
end
function Camera.endCinematicScene(self)
    EndCinematicScene()
end
function Camera.forceCinematicSubtitles(self, flag)
    ForceCinematicSubtitles(flag)
end
function Camera.getMargin(self, whichMargin)
    return GetCameraMargin(whichMargin)
end
function Camera.pan(self, x, y, zOffsetDest)
    if not zOffsetDest then
        PanCameraTo(x, y)
    else
        PanCameraToWithZ(x, y, zOffsetDest)
    end
end
function Camera.panTimed(self, x, y, duration, zOffsetDest)
    if not zOffsetDest then
        PanCameraToTimed(x, y, duration)
    else
        PanCameraToTimedWithZ(x, y, zOffsetDest, duration)
    end
end
function Camera.reset(self, duration)
    ResetToGameCamera(duration)
end
function Camera.setBounds(self, x1, y1, x2, y2, x3, y3, x4, y4)
    SetCameraBounds(x1, y1, x2, y2, x3, y3, x4, y4)
end
function Camera.setCameraOrientController(self, whichUnit, xOffset, yOffset)
    SetCameraOrientController(whichUnit, xOffset, yOffset)
end
function Camera.setCineFilterBlendMode(self, whichMode)
    SetCineFilterBlendMode(whichMode)
end
function Camera.setCineFilterDuration(self, duration)
    SetCineFilterDuration(duration)
end
function Camera.setCineFilterEndColor(self, red, green, blue, alpha)
    SetCineFilterEndColor(red, green, blue, alpha)
end
function Camera.setCineFilterEndUV(self, minU, minV, maxU, maxV)
    SetCineFilterEndUV(minU, minV, maxU, maxV)
end
function Camera.setCineFilterStartColor(self, red, green, blue, alpha)
    SetCineFilterStartColor(red, green, blue, alpha)
end
function Camera.setCineFilterStartUV(self, minU, minV, maxU, maxV)
    SetCineFilterStartUV(minU, minV, maxU, maxV)
end
function Camera.setCineFilterTexMapFlags(self, whichFlags)
    SetCineFilterTexMapFlags(whichFlags)
end
function Camera.setCineFilterTexture(self, fileName)
    SetCineFilterTexture(fileName)
end
function Camera.setCinematicAudio(self, cinematicAudio)
    SetCinematicAudio(cinematicAudio)
end
function Camera.setCinematicCamera(self, cameraModelFile)
    SetCinematicCamera(cameraModelFile)
end
function Camera.SetCinematicScene(self, portraitUnitId, color, speakerTitle, text, sceneDuration, voiceoverDuration)
    SetCinematicScene(portraitUnitId, color, speakerTitle, text, sceneDuration, voiceoverDuration)
end
function Camera.setDepthOfFieldScale(self, scale)
    CameraSetDepthOfFieldScale(scale)
end
function Camera.setField(self, whichField, value, duration)
    SetCameraField(whichField, value, duration)
end
function Camera.setFocalDistance(self, distance)
    CameraSetFocalDistance(distance)
end
function Camera.setPos(self, x, y)
    SetCameraPosition(x, y)
end
function Camera.setRotateMode(self, x, y, radiansToSweep, duration)
    SetCameraRotateMode(x, y, radiansToSweep, duration)
end
function Camera.setSmoothingFactor(self, factor)
    CameraSetSmoothingFactor(factor)
end
function Camera.setSourceNoise(self, mag, velocity, vertOnly)
    if vertOnly == nil then
        vertOnly = false
    end
    CameraSetSourceNoiseEx(mag, velocity, vertOnly)
end
function Camera.setTargetController(self, whichUnit, xOffset, yOffset, inheritOrientation)
    SetCameraTargetController(whichUnit, xOffset, yOffset, inheritOrientation)
end
function Camera.setTargetNoise(self, mag, velocity, vertOnly)
    if vertOnly == nil then
        vertOnly = false
    end
    CameraSetTargetNoiseEx(mag, velocity, vertOnly)
end
function Camera.stop(self)
    StopCamera()
end
____exports.CameraSetup = __TS__Class()
local CameraSetup = ____exports.CameraSetup
CameraSetup.name = "CameraSetup"
__TS__ClassExtends(CameraSetup, Handle)
function CameraSetup.prototype.____constructor(self)
    Handle.prototype.____constructor(
        self,
        ((Handle:initFromHandle() and (function() return nil end)) or (function() return CreateCameraSetup() end))()
    )
end
__TS__SetDescriptor(
    CameraSetup.prototype,
    "destPoint",
    {
        get = function(self)
            return CameraSetupGetDestPositionLoc(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    CameraSetup.prototype,
    "destX",
    {
        get = function(self)
            return CameraSetupGetDestPositionX(self.handle)
        end,
        set = function(self, x)
            CameraSetupSetDestPosition(self.handle, x, self.destY, 0)
        end
    },
    true
)
__TS__SetDescriptor(
    CameraSetup.prototype,
    "destY",
    {
        get = function(self)
            return CameraSetupGetDestPositionY(self.handle)
        end,
        set = function(self, y)
            CameraSetupSetDestPosition(self.handle, self.destX, y, 0)
        end
    },
    true
)
__TS__SetDescriptor(
    CameraSetup.prototype,
    "label",
    {
        get = function(self)
            return BlzCameraSetupGetLabel(self.handle)
        end,
        set = function(self, label)
            BlzCameraSetupSetLabel(self.handle, label)
        end
    },
    true
)
function CameraSetup.prototype.apply(self, doPan, panTimed)
    CameraSetupApply(self.handle, doPan, panTimed)
end
function CameraSetup.prototype.applyForceDuration(self, doPan, forceDuration)
    CameraSetupApplyForceDuration(self.handle, doPan, forceDuration)
end
function CameraSetup.prototype.applyForceDurationSmooth(self, doPan, forcedDuration, easeInDuration, easeOutDuration, smoothFactor)
    BlzCameraSetupApplyForceDurationSmooth(self.handle, doPan, forcedDuration, easeInDuration, easeOutDuration, smoothFactor)
end
function CameraSetup.prototype.applyForceDurationZ(self, zDestOffset, forceDuration)
    CameraSetupApplyForceDurationWithZ(self.handle, zDestOffset, forceDuration)
end
function CameraSetup.prototype.applyZ(self, zDestOffset)
    CameraSetupApplyWithZ(self.handle, zDestOffset)
end
function CameraSetup.prototype.getField(self, whichField)
    return CameraSetupGetField(self.handle, whichField)
end
function CameraSetup.prototype.setDestPos(self, x, y, duration)
    CameraSetupSetDestPosition(self.handle, x, y, duration)
end
function CameraSetup.prototype.setField(self, whichField, value, duration)
    CameraSetupSetField(self.handle, whichField, value, duration)
end
function CameraSetup.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.widget"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Widget = __TS__Class()
local Widget = ____exports.Widget
Widget.name = "Widget"
__TS__ClassExtends(Widget, Handle)
__TS__SetDescriptor(
    Widget.prototype,
    "life",
    {
        get = function(self)
            return GetWidgetLife(self.handle)
        end,
        set = function(self, value)
            SetWidgetLife(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Widget.prototype,
    "x",
    {
        get = function(self)
            return GetWidgetX(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Widget.prototype,
    "y",
    {
        get = function(self)
            return GetWidgetY(self.handle)
        end
    },
    true
)
function Widget.fromEvent(self)
    return self:fromHandle(
        GetTriggerWidget()
    )
end
function Widget.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.destructable"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
local ____widget = require("node_modules.w3ts.handles.widget")
local Widget = ____widget.Widget
____exports.Destructable = __TS__Class()
local Destructable = ____exports.Destructable
Destructable.name = "Destructable"
__TS__ClassExtends(Destructable, Widget)
function Destructable.prototype.____constructor(self, objectId, x, y, z, face, scale, varation)
    if Handle:initFromHandle() then
        Widget.prototype.____constructor(self)
    else
        Widget.prototype.____constructor(
            self,
            CreateDestructableZ(objectId, x, y, z, face, scale, varation)
        )
    end
end
__TS__SetDescriptor(
    Destructable.prototype,
    "invulnerable",
    {
        get = function(self)
            return IsDestructableInvulnerable(self.handle)
        end,
        set = function(self, flag)
            SetDestructableInvulnerable(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Destructable.prototype,
    "life",
    {
        get = function(self)
            return GetDestructableLife(self.handle)
        end,
        set = function(self, value)
            SetDestructableLife(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Destructable.prototype,
    "maxLife",
    {
        get = function(self)
            return GetDestructableMaxLife(self.handle)
        end,
        set = function(self, value)
            SetDestructableMaxLife(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Destructable.prototype,
    "name",
    {
        get = function(self)
            return GetDestructableName(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Destructable.prototype,
    "occluderHeight",
    {
        get = function(self)
            return GetDestructableOccluderHeight(self.handle)
        end,
        set = function(self, value)
            SetDestructableOccluderHeight(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Destructable.prototype,
    "typeId",
    {
        get = function(self)
            return GetDestructableTypeId(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Destructable.prototype,
    "x",
    {
        get = function(self)
            return GetDestructableX(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Destructable.prototype,
    "y",
    {
        get = function(self)
            return GetDestructableY(self.handle)
        end
    },
    true
)
function Destructable.prototype.destroy(self)
    RemoveDestructable(self.handle)
end
function Destructable.prototype.heal(self, life, birth)
    DestructableRestoreLife(self.handle, life, birth)
end
function Destructable.prototype.kill(self)
    KillDestructable(self.handle)
end
function Destructable.prototype.queueAnim(self, whichAnimation)
    QueueDestructableAnimation(self.handle, whichAnimation)
end
function Destructable.prototype.setAnim(self, whichAnimation)
    SetDestructableAnimation(self.handle, whichAnimation)
end
function Destructable.prototype.setAnimSpeed(self, speedFactor)
    SetDestructableAnimationSpeed(self.handle, speedFactor)
end
function Destructable.prototype.show(self, flag)
    ShowDestructable(self.handle, flag)
end
function Destructable.fromEvent(self)
    return self:fromHandle(
        GetTriggerDestructable()
    )
end
function Destructable.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.force"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
local ____player = require("node_modules.w3ts.handles.player")
local MapPlayer = ____player.MapPlayer
____exports.Force = __TS__Class()
local Force = ____exports.Force
Force.name = "Force"
__TS__ClassExtends(Force, Handle)
function Force.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateForce()
        )
    end
end
function Force.prototype.addPlayer(self, whichPlayer)
    ForceAddPlayer(self.handle, whichPlayer.handle)
end
function Force.prototype.clear(self)
    ForceClear(self.handle)
end
function Force.prototype.destroy(self)
    DestroyForce(self.handle)
end
function Force.prototype.enumAllies(self, whichPlayer, filter)
    ForceEnumAllies(
        self.handle,
        whichPlayer.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Force.prototype.enumEnemies(self, whichPlayer, filter)
    ForceEnumEnemies(
        self.handle,
        whichPlayer.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Force.prototype.enumPlayers(self, filter)
    ForceEnumPlayers(
        self.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Force.prototype.enumPlayersCounted(self, filter, countLimit)
    ForceEnumPlayersCounted(
        self.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))(),
        countLimit
    )
end
Force.prototype["for"] = function(self, callback)
    ForForce(self.handle, callback)
end
function Force.prototype.getPlayers(self)
    local players = {}
    ForForce(
        self.handle,
        function() return __TS__ArrayPush(
            players,
            MapPlayer:fromEnum()
        ) end
    )
    return players
end
function Force.prototype.hasPlayer(self, whichPlayer)
    return IsPlayerInForce(whichPlayer.handle, self.handle)
end
function Force.prototype.removePlayer(self, whichPlayer)
    ForceRemovePlayer(self.handle, whichPlayer.handle)
end
function Force.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.player"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.MapPlayer = __TS__Class()
local MapPlayer = ____exports.MapPlayer
MapPlayer.name = "MapPlayer"
__TS__ClassExtends(MapPlayer, Handle)
function MapPlayer.prototype.____constructor(self, index)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            Player(index)
        )
    end
end
__TS__SetDescriptor(
    MapPlayer.prototype,
    "color",
    {
        get = function(self)
            return GetPlayerColor(self.handle)
        end,
        set = function(self, color)
            SetPlayerColor(self.handle, color)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "controller",
    {
        get = function(self)
            return GetPlayerController(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "handicap",
    {
        get = function(self)
            return GetPlayerHandicap(self.handle)
        end,
        set = function(self, handicap)
            SetPlayerHandicap(self.handle, handicap)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "handicapXp",
    {
        get = function(self)
            return GetPlayerHandicapXP(self.handle)
        end,
        set = function(self, handicap)
            SetPlayerHandicapXP(self.handle, handicap)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "id",
    {
        get = function(self)
            return GetPlayerId(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "name",
    {
        get = function(self)
            return GetPlayerName(self.handle)
        end,
        set = function(self, value)
            SetPlayerName(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "race",
    {
        get = function(self)
            return GetPlayerRace(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "slotState",
    {
        get = function(self)
            return GetPlayerSlotState(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "startLocation",
    {
        get = function(self)
            return GetPlayerStartLocation(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "startLocationX",
    {
        get = function(self)
            return GetStartLocationX(self.startLocation)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "startLocationY",
    {
        get = function(self)
            return GetStartLocationY(self.startLocation)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "startLocationPoint",
    {
        get = function(self)
            return GetStartLocationLoc(self.startLocation)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "team",
    {
        get = function(self)
            return GetPlayerTeam(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    MapPlayer.prototype,
    "townHallCount",
    {
        get = function(self)
            return BlzGetPlayerTownHallCount(self.handle)
        end
    },
    true
)
function MapPlayer.prototype.addTechResearched(self, techId, levels)
    AddPlayerTechResearched(self.handle, techId, levels)
end
function MapPlayer.prototype.decTechResearched(self, techId, levels)
    BlzDecPlayerTechResearched(self.handle, techId, levels)
end
function MapPlayer.prototype.cacheHeroData(self)
    CachePlayerHeroData(self.handle)
end
function MapPlayer.prototype.compareAlliance(self, otherPlayer, whichAllianceSetting)
    return GetPlayerAlliance(self.handle, otherPlayer.handle, whichAllianceSetting)
end
function MapPlayer.prototype.coordsFogged(self, x, y)
    return IsFoggedToPlayer(x, y, self.handle)
end
function MapPlayer.prototype.coordsMasked(self, x, y)
    return IsMaskedToPlayer(x, y, self.handle)
end
function MapPlayer.prototype.coordsVisible(self, x, y)
    return IsVisibleToPlayer(x, y, self.handle)
end
function MapPlayer.prototype.cripple(self, toWhichPlayers, flag)
    CripplePlayer(self.handle, toWhichPlayers.handle, flag)
end
function MapPlayer.prototype.getScore(self, whichPlayerScore)
    return GetPlayerScore(self.handle, whichPlayerScore)
end
function MapPlayer.prototype.getState(self, whichPlayerState)
    return GetPlayerState(self.handle, whichPlayerState)
end
function MapPlayer.prototype.getStructureCount(self, includeIncomplete)
    return GetPlayerStructureCount(self.handle, includeIncomplete)
end
function MapPlayer.prototype.getTaxRate(self, otherPlayer, whichResource)
    return GetPlayerTaxRate(self.handle, otherPlayer, whichResource)
end
function MapPlayer.prototype.getTechCount(self, techId, specificonly)
    return GetPlayerTechCount(self.handle, techId, specificonly)
end
function MapPlayer.prototype.getTechMaxAllowed(self, techId)
    return GetPlayerTechMaxAllowed(self.handle, techId)
end
function MapPlayer.prototype.getTechResearched(self, techId, specificonly)
    return GetPlayerTechResearched(self.handle, techId, specificonly)
end
function MapPlayer.prototype.getUnitCount(self, includeIncomplete)
    return GetPlayerUnitCount(self.handle, includeIncomplete)
end
function MapPlayer.prototype.getUnitCountByType(self, unitName, includeIncomplete, includeUpgrades)
    return GetPlayerTypedUnitCount(self.handle, unitName, includeIncomplete, includeUpgrades)
end
function MapPlayer.prototype.inForce(self, whichForce)
    return IsPlayerInForce(self.handle, whichForce.handle)
end
function MapPlayer.prototype.isLocal(self)
    return GetLocalPlayer() == self.handle
end
function MapPlayer.prototype.isObserver(self)
    return IsPlayerObserver(self.handle)
end
function MapPlayer.prototype.isPlayerAlly(self, otherPlayer)
    return IsPlayerAlly(self.handle, otherPlayer.handle)
end
function MapPlayer.prototype.isPlayerEnemy(self, otherPlayer)
    return IsPlayerEnemy(self.handle, otherPlayer.handle)
end
function MapPlayer.prototype.isRacePrefSet(self, pref)
    return IsPlayerRacePrefSet(self.handle, pref)
end
function MapPlayer.prototype.isSelectable(self)
    return GetPlayerSelectable(self.handle)
end
function MapPlayer.prototype.pointFogged(self, whichPoint)
    return IsLocationFoggedToPlayer(whichPoint.handle, self.handle)
end
function MapPlayer.prototype.pointMasked(self, whichPoint)
    return IsLocationMaskedToPlayer(whichPoint.handle, self.handle)
end
function MapPlayer.prototype.pointVisible(self, whichPoint)
    return IsLocationVisibleToPlayer(whichPoint.handle, self.handle)
end
function MapPlayer.prototype.remove(self, gameResult)
    RemovePlayer(self.handle, gameResult)
end
function MapPlayer.prototype.removeAllGuardPositions(self)
    RemoveAllGuardPositions(self.handle)
end
function MapPlayer.prototype.setAbilityAvailable(self, abilId, avail)
    SetPlayerAbilityAvailable(self.handle, abilId, avail)
end
function MapPlayer.prototype.setAlliance(self, otherPlayer, whichAllianceSetting, value)
    SetPlayerAlliance(self.handle, otherPlayer.handle, whichAllianceSetting, value)
end
function MapPlayer.prototype.setOnScoreScreen(self, flag)
    SetPlayerOnScoreScreen(self.handle, flag)
end
function MapPlayer.prototype.setState(self, whichPlayerState, value)
    SetPlayerState(self.handle, whichPlayerState, value)
end
function MapPlayer.prototype.setTaxRate(self, otherPlayer, whichResource, rate)
    SetPlayerTaxRate(self.handle, otherPlayer.handle, whichResource, rate)
end
function MapPlayer.prototype.setTechMaxAllowed(self, techId, maximum)
    SetPlayerTechMaxAllowed(self.handle, techId, maximum)
end
function MapPlayer.prototype.setTechResearched(self, techId, setToLevel)
    SetPlayerTechResearched(self.handle, techId, setToLevel)
end
function MapPlayer.prototype.setUnitsOwner(self, newOwner)
    SetPlayerUnitsOwner(self.handle, newOwner)
end
function MapPlayer.fromEnum(self)
    return ____exports.MapPlayer:fromHandle(
        GetEnumPlayer()
    )
end
function MapPlayer.fromEvent(self)
    return ____exports.MapPlayer:fromHandle(
        GetTriggerPlayer()
    )
end
function MapPlayer.fromFilter(self)
    return ____exports.MapPlayer:fromHandle(
        GetFilterPlayer()
    )
end
function MapPlayer.fromHandle(self, handle)
    return self:getObject(handle)
end
function MapPlayer.fromIndex(self, index)
    return self:fromHandle(
        Player(index)
    )
end
function MapPlayer.fromLocal(self)
    return self:fromHandle(
        GetLocalPlayer()
    )
end
return ____exports
end,
["node_modules.w3ts.handles.dialog"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.DialogButton = __TS__Class()
local DialogButton = ____exports.DialogButton
DialogButton.name = "DialogButton"
__TS__ClassExtends(DialogButton, Handle)
function DialogButton.prototype.____constructor(self, whichDialog, text, hotkey, quit, score)
    if hotkey == nil then
        hotkey = 0
    end
    if quit == nil then
        quit = false
    end
    if score == nil then
        score = false
    end
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    elseif not quit then
        Handle.prototype.____constructor(
            self,
            DialogAddButton(whichDialog.handle, text, hotkey)
        )
    else
        Handle.prototype.____constructor(
            self,
            DialogAddQuitButton(whichDialog.handle, score, text, hotkey)
        )
    end
end
function DialogButton.fromHandle(self, handle)
    return self:getObject(handle)
end
____exports.Dialog = __TS__Class()
local Dialog = ____exports.Dialog
Dialog.name = "Dialog"
__TS__ClassExtends(Dialog, Handle)
function Dialog.prototype.____constructor(self)
    Handle.prototype.____constructor(
        self,
        ((Handle:initFromHandle() and (function() return nil end)) or (function() return DialogCreate() end))()
    )
end
function Dialog.prototype.addButton(self, text, hotkey, quit, score)
    if hotkey == nil then
        hotkey = 0
    end
    if quit == nil then
        quit = false
    end
    if score == nil then
        score = false
    end
    return __TS__New(____exports.DialogButton, self, text, hotkey, quit, score)
end
function Dialog.prototype.clear(self)
    DialogClear(self.handle)
end
function Dialog.prototype.destroy(self)
    DialogDestroy(self.handle)
end
function Dialog.prototype.display(self, whichPlayer, flag)
    DialogDisplay(whichPlayer.handle, self.handle, flag)
end
function Dialog.prototype.setMessage(self, whichMessage)
    DialogSetMessage(self.handle, whichMessage)
end
function Dialog.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.effect"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Effect = __TS__Class()
local Effect = ____exports.Effect
Effect.name = "Effect"
__TS__ClassExtends(Effect, Handle)
function Effect.prototype.____constructor(self, modelName, a, b)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    elseif (type(a) == "number") and (type(b) == "number") then
        Handle.prototype.____constructor(
            self,
            AddSpecialEffect(modelName, a, b)
        )
    elseif (type(a) ~= "number") and (type(b) == "string") then
        Handle.prototype.____constructor(
            self,
            AddSpecialEffectTarget(modelName, a.handle, b)
        )
    end
end
__TS__SetDescriptor(
    Effect.prototype,
    "scale",
    {
        get = function(self)
            return BlzGetSpecialEffectScale(self.handle)
        end,
        set = function(self, scale)
            BlzSetSpecialEffectScale(self.handle, scale)
        end
    },
    true
)
__TS__SetDescriptor(
    Effect.prototype,
    "x",
    {
        get = function(self)
            return BlzGetLocalSpecialEffectX(self.handle)
        end,
        set = function(self, x)
            BlzSetSpecialEffectX(self.handle, x)
        end
    },
    true
)
__TS__SetDescriptor(
    Effect.prototype,
    "y",
    {
        get = function(self)
            return BlzGetLocalSpecialEffectY(self.handle)
        end,
        set = function(self, y)
            BlzSetSpecialEffectY(self.handle, y)
        end
    },
    true
)
__TS__SetDescriptor(
    Effect.prototype,
    "z",
    {
        get = function(self)
            return BlzGetLocalSpecialEffectZ(self.handle)
        end,
        set = function(self, z)
            BlzSetSpecialEffectZ(self.handle, z)
        end
    },
    true
)
function Effect.prototype.addSubAnimation(self, subAnim)
    BlzSpecialEffectAddSubAnimation(self.handle, subAnim)
end
function Effect.prototype.clearSubAnimations(self)
    BlzSpecialEffectClearSubAnimations(self.handle)
end
function Effect.prototype.destroy(self)
    DestroyEffect(self.handle)
end
function Effect.prototype.playAnimation(self, animType)
    BlzPlaySpecialEffect(self.handle, animType)
end
function Effect.prototype.playWithTimeScale(self, animType, timeScale)
    BlzPlaySpecialEffectWithTimeScale(self.handle, animType, timeScale)
end
function Effect.prototype.removeSubAnimation(self, subAnim)
    BlzSpecialEffectRemoveSubAnimation(self.handle, subAnim)
end
function Effect.prototype.resetScaleMatrix(self)
    BlzResetSpecialEffectMatrix(self.handle)
end
function Effect.prototype.setAlpha(self, alpha)
    BlzSetSpecialEffectAlpha(self.handle, alpha)
end
function Effect.prototype.setColor(self, red, green, blue)
    BlzSetSpecialEffectColor(self.handle, red, green, blue)
end
function Effect.prototype.setColorByPlayer(self, whichPlayer)
    BlzSetSpecialEffectColorByPlayer(self.handle, whichPlayer.handle)
end
function Effect.prototype.setHeight(self, height)
    BlzSetSpecialEffectHeight(self.handle, height)
end
function Effect.prototype.setOrientation(self, yaw, pitch, roll)
    BlzSetSpecialEffectOrientation(self.handle, yaw, pitch, roll)
end
function Effect.prototype.setPitch(self, pitch)
    BlzSetSpecialEffectPitch(self.handle, pitch)
end
function Effect.prototype.setPoint(self, p)
    BlzSetSpecialEffectPositionLoc(self.handle, p.handle)
end
function Effect.prototype.setPosition(self, x, y, z)
    BlzSetSpecialEffectPosition(self.handle, x, y, z)
end
function Effect.prototype.setRoll(self, roll)
    BlzSetSpecialEffectRoll(self.handle, roll)
end
function Effect.prototype.setScaleMatrix(self, x, y, z)
    BlzSetSpecialEffectMatrixScale(self.handle, x, y, z)
end
function Effect.prototype.setTime(self, value)
    BlzSetSpecialEffectTime(self.handle, value)
end
function Effect.prototype.setTimeScale(self, timeScale)
    BlzSetSpecialEffectTimeScale(self.handle, timeScale)
end
function Effect.prototype.setYaw(self, y)
    BlzSetSpecialEffectYaw(self.handle, y)
end
function Effect.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.rect"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Rectangle = __TS__Class()
local Rectangle = ____exports.Rectangle
Rectangle.name = "Rectangle"
__TS__ClassExtends(Rectangle, Handle)
function Rectangle.prototype.____constructor(self, minX, minY, maxX, maxY)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            Rect(minX, minY, maxX, maxY)
        )
    end
end
__TS__SetDescriptor(
    Rectangle.prototype,
    "centerX",
    {
        get = function(self)
            return GetRectCenterX(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Rectangle.prototype,
    "centerY",
    {
        get = function(self)
            return GetRectCenterY(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Rectangle.prototype,
    "maxX",
    {
        get = function(self)
            return GetRectMaxX(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Rectangle.prototype,
    "maxY",
    {
        get = function(self)
            return GetRectMaxY(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Rectangle.prototype,
    "minX",
    {
        get = function(self)
            return GetRectMinX(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Rectangle.prototype,
    "minY",
    {
        get = function(self)
            return GetRectMinY(self.handle)
        end
    },
    true
)
function Rectangle.prototype.destroy(self)
    RemoveRect(self.handle)
end
function Rectangle.prototype.enumDestructables(self, filter, actionFunc)
    EnumDestructablesInRect(
        self.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))(),
        actionFunc
    )
end
function Rectangle.prototype.enumItems(self, filter, actionFunc)
    EnumItemsInRect(
        self.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))(),
        actionFunc
    )
end
function Rectangle.prototype.move(self, newCenterX, newCenterY)
    MoveRectTo(self.handle, newCenterX, newCenterY)
end
function Rectangle.prototype.movePoint(self, newCenterPoint)
    MoveRectToLoc(self.handle, newCenterPoint.handle)
end
function Rectangle.prototype.setRect(self, minX, minY, maxX, maxY)
    SetRect(self.handle, minX, minY, maxX, maxY)
end
function Rectangle.prototype.setRectFromPoint(self, min, max)
    SetRectFromLoc(self.handle, min.handle, max.handle)
end
function Rectangle.fromHandle(self, handle)
    return self:getObject(handle)
end
function Rectangle.fromPoint(self, min, max)
    return self:fromHandle(
        RectFromLoc(min.handle, max.handle)
    )
end
function Rectangle.getWorldBounds(self)
    return ____exports.Rectangle:fromHandle(
        GetWorldBounds()
    )
end
return ____exports
end,
["node_modules.w3ts.handles.fogmodifier"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.FogModifier = __TS__Class()
local FogModifier = ____exports.FogModifier
FogModifier.name = "FogModifier"
__TS__ClassExtends(FogModifier, Handle)
function FogModifier.prototype.____constructor(self, forWhichPlayer, whichState, centerX, centerY, radius, useSharedVision, afterUnits)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateFogModifierRadius(forWhichPlayer.handle, whichState, centerX, centerY, radius, useSharedVision, afterUnits)
        )
    end
end
function FogModifier.prototype.destroy(self)
    DestroyFogModifier(self.handle)
end
function FogModifier.prototype.start(self)
    FogModifierStart(self.handle)
end
function FogModifier.prototype.stop(self)
    FogModifierStop(self.handle)
end
function FogModifier.fromHandle(self, handle)
    return self:getObject(handle)
end
function FogModifier.fromRect(self, forWhichPlayer, whichState, where, useSharedVision, afterUnits)
    return self:fromHandle(
        CreateFogModifierRect(forWhichPlayer.handle, whichState, where.handle, useSharedVision, afterUnits)
    )
end
return ____exports
end,
["node_modules.w3ts.handles.frame"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Frame = __TS__Class()
local Frame = ____exports.Frame
Frame.name = "Frame"
__TS__ClassExtends(Frame, Handle)
function Frame.prototype.____constructor(self, name, owner, priority, createContext)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        if not createContext then
            Handle.prototype.____constructor(
                self,
                BlzCreateSimpleFrame(name, owner.handle, priority)
            )
        else
            Handle.prototype.____constructor(
                self,
                BlzCreateFrame(name, owner.handle, priority, createContext)
            )
        end
    end
end
__TS__SetDescriptor(
    Frame.prototype,
    "alpha",
    {
        get = function(self)
            return BlzFrameGetAlpha(self.handle)
        end,
        set = function(self, alpha)
            BlzFrameSetAlpha(self.handle, alpha)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "children",
    {
        get = function(self)
            local count = self.childrenCount
            local output = {}
            do
                local i = 0
                while i < count do
                    __TS__ArrayPush(
                        output,
                        self:getChild(i)
                    )
                    i = i + 1
                end
            end
            return output
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "childrenCount",
    {
        get = function(self)
            return BlzFrameGetChildrenCount(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "enabled",
    {
        get = function(self)
            return BlzFrameGetEnable(self.handle)
        end,
        set = function(self, flag)
            BlzFrameSetEnable(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "height",
    {
        get = function(self)
            return BlzFrameGetHeight(self.handle)
        end,
        set = function(self, height)
            BlzFrameSetSize(self.handle, self.width, height)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "parent",
    {
        get = function(self)
            return ____exports.Frame:fromHandle(
                BlzFrameGetParent(self.handle)
            )
        end,
        set = function(self, parent)
            BlzFrameSetParent(self.handle, parent.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "text",
    {
        get = function(self)
            return BlzFrameGetText(self.handle)
        end,
        set = function(self, text)
            BlzFrameSetText(self.handle, text)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "textSizeLimit",
    {
        get = function(self)
            return BlzFrameGetTextSizeLimit(self.handle)
        end,
        set = function(self, size)
            BlzFrameSetTextSizeLimit(self.handle, size)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "value",
    {
        get = function(self)
            return BlzFrameGetValue(self.handle)
        end,
        set = function(self, value)
            BlzFrameSetValue(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "visible",
    {
        get = function(self)
            return BlzFrameIsVisible(self.handle)
        end,
        set = function(self, flag)
            BlzFrameSetVisible(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Frame.prototype,
    "width",
    {
        get = function(self)
            return BlzFrameGetWidth(self.handle)
        end,
        set = function(self, width)
            BlzFrameSetSize(self.handle, width, self.height)
        end
    },
    true
)
function Frame.prototype.addText(self, text)
    BlzFrameAddText(self.handle, text)
    return self
end
function Frame.prototype.cageMouse(self, enable)
    BlzFrameCageMouse(self.handle, enable)
    return self
end
function Frame.prototype.clearPoints(self)
    BlzFrameClearAllPoints(self.handle)
    return self
end
function Frame.prototype.click(self)
    BlzFrameClick(self.handle)
    return self
end
function Frame.prototype.destroy(self)
    BlzDestroyFrame(self.handle)
    return self
end
function Frame.prototype.getChild(self, index)
    return ____exports.Frame:fromHandle(
        BlzFrameGetChild(self.handle, index)
    )
end
function Frame.prototype.setAbsPoint(self, point, x, y)
    BlzFrameSetAbsPoint(self.handle, point, x, y)
    return self
end
function Frame.prototype.setAllPoints(self, relative)
    BlzFrameSetAllPoints(self.handle, relative.handle)
    return self
end
function Frame.prototype.setAlpha(self, alpha)
    BlzFrameSetAlpha(self.handle, alpha)
    return self
end
function Frame.prototype.setEnabled(self, flag)
    BlzFrameSetEnable(self.handle, flag)
    return self
end
function Frame.prototype.setFocus(self, flag)
    BlzFrameSetFocus(self.handle, flag)
    return self
end
function Frame.prototype.setFont(self, filename, height, flags)
    BlzFrameSetFont(self.handle, filename, height, flags)
    return self
end
function Frame.prototype.setHeight(self, height)
    BlzFrameSetSize(self.handle, self.width, height)
    return self
end
function Frame.prototype.setLevel(self, level)
    BlzFrameSetLevel(self.handle, level)
    return self
end
function Frame.prototype.setMinMaxValue(self, minValue, maxValue)
    BlzFrameSetMinMaxValue(self.handle, minValue, maxValue)
    return self
end
function Frame.prototype.setModel(self, modelFile, cameraIndex)
    BlzFrameSetModel(self.handle, modelFile, cameraIndex)
    return self
end
function Frame.prototype.setParent(self, parent)
    BlzFrameSetParent(self.handle, parent.handle)
    return self
end
function Frame.prototype.setPoint(self, point, relative, relativePoint, x, y)
    BlzFrameSetPoint(self.handle, point, relative.handle, relativePoint, x, y)
    return self
end
function Frame.prototype.setScale(self, scale)
    BlzFrameSetScale(self.handle, scale)
    return self
end
function Frame.prototype.setSize(self, width, height)
    BlzFrameSetSize(self.handle, width, height)
    return self
end
function Frame.prototype.setSpriteAnimate(self, primaryProp, flags)
    BlzFrameSetSpriteAnimate(self.handle, primaryProp, flags)
    return self
end
function Frame.prototype.setStepSize(self, stepSize)
    BlzFrameSetStepSize(self.handle, stepSize)
    return self
end
function Frame.prototype.setText(self, text)
    BlzFrameSetText(self.handle, text)
    return self
end
function Frame.prototype.setTextColor(self, color)
    BlzFrameSetTextColor(self.handle, color)
    return self
end
function Frame.prototype.setTextSizeLimit(self, size)
    BlzFrameSetTextSizeLimit(self.handle, size)
    return self
end
function Frame.prototype.setTexture(self, texFile, flag, blend)
    BlzFrameSetTexture(self.handle, texFile, flag, blend)
    return self
end
function Frame.prototype.setTooltip(self, tooltip)
    BlzFrameSetTooltip(self.handle, tooltip.handle)
    return self
end
function Frame.prototype.setValue(self, value)
    BlzFrameSetValue(self.handle, value)
    return self
end
function Frame.prototype.setVertexColor(self, color)
    BlzFrameSetVertexColor(self.handle, color)
    return self
end
function Frame.prototype.setVisible(self, flag)
    BlzFrameSetVisible(self.handle, flag)
    return self
end
function Frame.prototype.setWidth(self, width)
    BlzFrameSetSize(self.handle, width, self.height)
    return self
end
function Frame.autoPosition(self, enable)
    BlzEnableUIAutoPosition(enable)
end
function Frame.fromEvent(self)
    return self:fromHandle(
        BlzGetTriggerFrame()
    )
end
function Frame.fromHandle(self, handle)
    return self:getObject(handle)
end
function Frame.fromName(self, name, createContext)
    return self:fromHandle(
        BlzGetFrameByName(name, createContext)
    )
end
function Frame.fromOrigin(self, frameType, index)
    return self:fromHandle(
        BlzGetOriginFrame(frameType, index)
    )
end
function Frame.getEventHandle(self)
    return BlzGetTriggerFrameEvent()
end
function Frame.getEventText(self)
    return BlzGetTriggerFrameValue()
end
function Frame.getEventValue(self)
    return BlzGetTriggerFrameValue()
end
function Frame.hideOrigin(self, enable)
    BlzHideOriginFrames(enable)
end
function Frame.loadTOC(self, filename)
    return BlzLoadTOCFile(filename)
end
return ____exports
end,
["node_modules.w3ts.handles.gamecache"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.GameCache = __TS__Class()
local GameCache = ____exports.GameCache
GameCache.name = "GameCache"
__TS__ClassExtends(GameCache, Handle)
function GameCache.prototype.____constructor(self, campaignFile)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            InitGameCache(campaignFile)
        )
    end
    self.filename = campaignFile
end
function GameCache.prototype.flush(self)
    FlushGameCache(self.handle)
end
function GameCache.prototype.flushBoolean(self, missionKey, key)
    FlushStoredBoolean(self.handle, missionKey, key)
end
function GameCache.prototype.flushInteger(self, missionKey, key)
    FlushStoredInteger(self.handle, missionKey, key)
end
function GameCache.prototype.flushMission(self, missionKey)
    FlushStoredMission(self.handle, missionKey)
end
function GameCache.prototype.flushNumber(self, missionKey, key)
    FlushStoredInteger(self.handle, missionKey, key)
end
function GameCache.prototype.flushString(self, missionKey, key)
    FlushStoredString(self.handle, missionKey, key)
end
function GameCache.prototype.flushUnit(self, missionKey, key)
    FlushStoredUnit(self.handle, missionKey, key)
end
function GameCache.prototype.getBoolean(self, missionKey, key)
    return GetStoredBoolean(self.handle, missionKey, key)
end
function GameCache.prototype.getInteger(self, missionKey, key)
    return GetStoredInteger(self.handle, missionKey, key)
end
function GameCache.prototype.getNumber(self, missionKey, key)
    return GetStoredReal(self.handle, missionKey, key)
end
function GameCache.prototype.getString(self, missionKey, key)
    return GetStoredString(self.handle, missionKey, key)
end
function GameCache.prototype.hasBoolean(self, missionKey, key)
    return HaveStoredBoolean(self.handle, missionKey, key)
end
function GameCache.prototype.hasInteger(self, missionKey, key)
    return HaveStoredInteger(self.handle, missionKey, key)
end
function GameCache.prototype.hasNumber(self, missionKey, key)
    return HaveStoredReal(self.handle, missionKey, key)
end
function GameCache.prototype.hasString(self, missionKey, key)
    return HaveStoredString(self.handle, missionKey, key)
end
function GameCache.prototype.restoreUnit(self, missionKey, key, forWhichPlayer, x, y, face)
    return RestoreUnit(self.handle, missionKey, key, forWhichPlayer.handle, x, y, face)
end
function GameCache.prototype.save(self)
    return SaveGameCache(self.handle)
end
function GameCache.prototype.store(self, missionKey, key, value)
    if type(value) == "string" then
        StoreString(self.handle, missionKey, key, value)
    elseif type(value) == "boolean" then
        StoreBoolean(self.handle, missionKey, key, value)
    elseif type(value) == "number" then
        StoreReal(self.handle, missionKey, key, value)
    else
        StoreUnit(self.handle, missionKey, key, value)
    end
end
function GameCache.prototype.syncBoolean(self, missionKey, key)
    return SyncStoredBoolean(self.handle, missionKey, key)
end
function GameCache.prototype.syncInteger(self, missionKey, key)
    return SyncStoredInteger(self.handle, missionKey, key)
end
function GameCache.prototype.syncNumber(self, missionKey, key)
    return SyncStoredReal(self.handle, missionKey, key)
end
function GameCache.prototype.syncString(self, missionKey, key)
    return SyncStoredString(self.handle, missionKey, key)
end
function GameCache.prototype.syncUnit(self, missionKey, key)
    return SyncStoredUnit(self.handle, missionKey, key)
end
function GameCache.fromHandle(self, handle)
    return self:getObject(handle)
end
function GameCache.reloadFromDisk(self)
    return ReloadGameCachesFromDisk()
end
return ____exports
end,
["node_modules.w3ts.globals.order"] = function() local ____exports = {}
return ____exports
end,
["node_modules.w3ts.handles.item"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
local ____widget = require("node_modules.w3ts.handles.widget")
local Widget = ____widget.Widget
____exports.Item = __TS__Class()
local Item = ____exports.Item
Item.name = "Item"
__TS__ClassExtends(Item, Widget)
function Item.prototype.____constructor(self, itemId, x, y, skinId)
    if Handle:initFromHandle() then
        Widget.prototype.____constructor(self)
    else
        Widget.prototype.____constructor(
            self,
            ((skinId and (function() return BlzCreateItemWithSkin(itemId, x, y, skinId) end)) or (function() return CreateItem(itemId, x, y) end))()
        )
    end
end
__TS__SetDescriptor(
    Item.prototype,
    "charges",
    {
        get = function(self)
            return GetItemCharges(self.handle)
        end,
        set = function(self, value)
            SetItemCharges(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "invulnerable",
    {
        get = function(self)
            return IsItemInvulnerable(self.handle)
        end,
        set = function(self, flag)
            SetItemInvulnerable(self.handle, true)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "level",
    {
        get = function(self)
            return GetItemLevel(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "name",
    {
        get = function(self)
            return GetItemName(self.handle)
        end,
        set = function(self, value)
            BlzSetItemName(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "pawnable",
    {
        get = function(self)
            return IsItemPawnable(self.handle)
        end,
        set = function(self, flag)
            SetItemPawnable(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "player",
    {
        get = function(self)
            return GetItemPlayer(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "type",
    {
        get = function(self)
            return GetItemType(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "typeId",
    {
        get = function(self)
            return GetItemTypeId(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "userData",
    {
        get = function(self)
            return GetItemUserData(self.handle)
        end,
        set = function(self, value)
            SetItemUserData(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "visible",
    {
        get = function(self)
            return IsItemVisible(self.handle)
        end,
        set = function(self, flag)
            SetItemVisible(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "skin",
    {
        get = function(self)
            return BlzGetItemSkin(self.handle)
        end,
        set = function(self, skinId)
            BlzSetItemSkin(self.handle, skinId)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "x",
    {
        get = function(self)
            return GetItemX(self.handle)
        end,
        set = function(self, value)
            SetItemPosition(self.handle, value, self.y)
        end
    },
    true
)
__TS__SetDescriptor(
    Item.prototype,
    "y",
    {
        get = function(self)
            return GetItemY(self.handle)
        end,
        set = function(self, value)
            SetItemPosition(self.handle, self.x, value)
        end
    },
    true
)
function Item.prototype.addAbility(self, abilCode)
    BlzItemAddAbility(self.handle, abilCode)
end
function Item.prototype.destroy(self)
    RemoveItem(self.handle)
end
function Item.prototype.getField(self, field)
    local fieldType = __TS__StringSubstr(
        tostring(field),
        0,
        (string.find(
            tostring(field),
            ":",
            nil,
            true
        ) or 0) - 1
    )
    local ____switch30 = fieldType
    if ____switch30 == "unitbooleanfield" then
        goto ____switch30_case_0
    elseif ____switch30 == "unitintegerfield" then
        goto ____switch30_case_1
    elseif ____switch30 == "unitrealfield" then
        goto ____switch30_case_2
    elseif ____switch30 == "unitstringfield" then
        goto ____switch30_case_3
    end
    goto ____switch30_case_default
    ::____switch30_case_0::
    do
        return BlzGetItemBooleanField(self.handle, field)
    end
    ::____switch30_case_1::
    do
        return BlzGetItemIntegerField(self.handle, field)
    end
    ::____switch30_case_2::
    do
        return BlzGetItemRealField(self.handle, field)
    end
    ::____switch30_case_3::
    do
        return BlzGetItemStringField(self.handle, field)
    end
    ::____switch30_case_default::
    do
        return 0
    end
    ::____switch30_end::
end
function Item.prototype.isOwned(self)
    return IsItemOwned(self.handle)
end
function Item.prototype.isPawnable(self)
    return IsItemPawnable(self.handle)
end
function Item.prototype.isPowerup(self)
    return IsItemPowerup(self.handle)
end
function Item.prototype.isSellable(self)
    return IsItemSellable(self.handle)
end
function Item.prototype.setDropId(self, unitId)
    SetItemDropID(self.handle, unitId)
end
function Item.prototype.setDropOnDeath(self, flag)
    SetItemDropOnDeath(self.handle, flag)
end
function Item.prototype.setDroppable(self, flag)
    SetItemDroppable(self.handle, flag)
end
function Item.prototype.setField(self, field, value)
    local fieldType = __TS__StringSubstr(
        tostring(field),
        0,
        (string.find(
            tostring(field),
            ":",
            nil,
            true
        ) or 0) - 1
    )
    if (fieldType == "unitbooleanfield") and (type(value) == "boolean") then
        return BlzSetItemBooleanField(self.handle, field, value)
    elseif (fieldType == "unitintegerfield") and (type(value) == "number") then
        return BlzSetItemIntegerField(self.handle, field, value)
    elseif (fieldType == "unitrealfield") and (type(value) == "number") then
        return BlzSetItemRealField(self.handle, field, value)
    elseif (fieldType == "unitstringfield") and (type(value) == "string") then
        return BlzSetItemStringField(self.handle, field, value)
    end
    return false
end
function Item.prototype.setOwner(self, whichPlayer, changeColor)
    SetItemPlayer(self.handle, whichPlayer.handle, changeColor)
end
function Item.prototype.setPoint(self, whichPoint)
    SetItemPosition(self.handle, whichPoint.x, whichPoint.y)
end
function Item.prototype.setPosition(self, x, y)
    SetItemPosition(self.handle, x, y)
end
function Item.fromEvent(self)
    return self:fromHandle(
        GetManipulatedItem()
    )
end
function Item.fromHandle(self, handle)
    return self:getObject(handle)
end
function Item.isIdPawnable(self, itemId)
    return IsItemIdPawnable(itemId)
end
function Item.isIdPowerup(self, itemId)
    return IsItemIdPowerup(itemId)
end
function Item.isIdSellable(self, itemId)
    return IsItemIdSellable(itemId)
end
return ____exports
end,
["node_modules.w3ts.handles.sound"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Sound = __TS__Class()
local Sound = ____exports.Sound
Sound.name = "Sound"
__TS__ClassExtends(Sound, Handle)
function Sound.prototype.____constructor(self, fileName, looping, is3D, stopWhenOutOfRange, fadeInRate, fadeOutRate, eaxSetting)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateSound(fileName, looping, is3D, stopWhenOutOfRange, fadeInRate, fadeOutRate, eaxSetting)
        )
    end
end
__TS__SetDescriptor(
    Sound.prototype,
    "dialogueSpeakerNameKey",
    {
        get = function(self)
            return GetDialogueSpeakerNameKey(self.handle)
        end,
        set = function(self, speakerName)
            SetDialogueSpeakerNameKey(self.handle, speakerName)
        end
    },
    true
)
__TS__SetDescriptor(
    Sound.prototype,
    "dialogueTextKey",
    {
        get = function(self)
            return GetDialogueTextKey(self.handle)
        end,
        set = function(self, dialogueText)
            SetDialogueTextKey(self.handle, dialogueText)
        end
    },
    true
)
__TS__SetDescriptor(
    Sound.prototype,
    "duration",
    {
        get = function(self)
            return GetSoundDuration(self.handle)
        end,
        set = function(self, duration)
            SetSoundDuration(self.handle, duration)
        end
    },
    true
)
__TS__SetDescriptor(
    Sound.prototype,
    "loading",
    {
        get = function(self)
            return GetSoundIsLoading(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Sound.prototype,
    "playing",
    {
        get = function(self)
            return GetSoundIsPlaying(self.handle)
        end
    },
    true
)
function Sound.prototype.killWhenDone(self)
    KillSoundWhenDone(self.handle)
end
function Sound.prototype.registerStacked(self, byPosition, rectWidth, rectHeight)
    RegisterStackedSound(self.handle, byPosition, rectWidth, rectHeight)
end
function Sound.prototype.setChannel(self, channel)
    SetSoundDistanceCutoff(self.handle, channel)
end
function Sound.prototype.setConeAngles(self, inside, outside, outsideVolume)
    SetSoundConeAngles(self.handle, inside, outside, outsideVolume)
end
function Sound.prototype.setConeOrientation(self, x, y, z)
    SetSoundConeOrientation(self.handle, x, y, z)
end
function Sound.prototype.setDistanceCutoff(self, cutoff)
    SetSoundDistanceCutoff(self.handle, cutoff)
end
function Sound.prototype.setDistances(self, minDist, maxDist)
    SetSoundDistances(self.handle, minDist, maxDist)
end
function Sound.prototype.setFacialAnimationFilepath(self, animationSetFilepath)
    SetSoundFacialAnimationSetFilepath(self.handle, animationSetFilepath)
end
function Sound.prototype.setFacialAnimationGroupLabel(self, groupLabel)
    SetSoundFacialAnimationGroupLabel(self.handle, groupLabel)
end
function Sound.prototype.setFacialAnimationLabel(self, animationLabel)
    SetSoundFacialAnimationLabel(self.handle, animationLabel)
end
function Sound.prototype.setParamsFromLabel(self, soundLabel)
    SetSoundParamsFromLabel(self.handle, soundLabel)
end
function Sound.prototype.setPitch(self, pitch)
    SetSoundPitch(self.handle, pitch)
end
function Sound.prototype.setPlayPosition(self, millisecs)
    SetSoundPlayPosition(self.handle, millisecs)
end
function Sound.prototype.setPosition(self, x, y, z)
    SetSoundPosition(self.handle, x, y, z)
end
function Sound.prototype.setVelocity(self, x, y, z)
    SetSoundVelocity(self.handle, x, y, z)
end
function Sound.prototype.setVolume(self, volume)
    SetSoundVolume(self.handle, volume)
end
function Sound.prototype.start(self)
    StartSound(self.handle)
end
function Sound.prototype.stop(self, killWhenDone, fadeOut)
    StopSound(self.handle, killWhenDone, fadeOut)
end
function Sound.prototype.unregisterStacked(self, byPosition, rectWidth, rectHeight)
    UnregisterStackedSound(self.handle, byPosition, rectWidth, rectHeight)
end
function Sound.fromHandle(self, handle)
    return self:getObject(handle)
end
function Sound.getFileDuration(self, fileName)
    return GetSoundFileDuration(fileName)
end
return ____exports
end,
["node_modules.w3ts.handles.unit"] = function() require("lualib_bundle");
local ____exports = {}
local ____destructable = require("node_modules.w3ts.handles.destructable")
local Destructable = ____destructable.Destructable
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
local ____item = require("node_modules.w3ts.handles.item")
local Item = ____item.Item
local ____player = require("node_modules.w3ts.handles.player")
local MapPlayer = ____player.MapPlayer
local ____point = require("node_modules.w3ts.handles.point")
local Point = ____point.Point
local ____widget = require("node_modules.w3ts.handles.widget")
local Widget = ____widget.Widget
____exports.Unit = __TS__Class()
local Unit = ____exports.Unit
Unit.name = "Unit"
__TS__ClassExtends(Unit, Widget)
function Unit.prototype.____constructor(self, owner, unitId, x, y, face, skinId)
    if Handle:initFromHandle() then
        Widget.prototype.____constructor(self)
    else
        local p = (((type(owner) == "number") and (function() return Player(owner) end)) or (function() return owner.handle end))()
        Widget.prototype.____constructor(
            self,
            ((skinId and (function() return BlzCreateUnitWithSkin(p, unitId, x, y, face, skinId) end)) or (function() return CreateUnit(p, unitId, x, y, face) end))()
        )
    end
end
__TS__SetDescriptor(
    Unit.prototype,
    "acquireRange",
    {
        get = function(self)
            return GetUnitAcquireRange(self.handle)
        end,
        set = function(self, value)
            SetUnitAcquireRange(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "agility",
    {
        get = function(self)
            return GetHeroAgi(self.handle, false)
        end,
        set = function(self, value)
            SetHeroAgi(self.handle, value, true)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "armor",
    {
        get = function(self)
            return BlzGetUnitArmor(self.handle)
        end,
        set = function(self, armorAmount)
            BlzSetUnitArmor(self.handle, armorAmount)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "canSleep",
    {
        get = function(self)
            return UnitCanSleep(self.handle)
        end,
        set = function(self, flag)
            UnitAddSleep(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "collisionSize",
    {
        get = function(self)
            return BlzGetUnitCollisionSize(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "color",
    {
        set = function(self, whichColor)
            SetUnitColor(self.handle, whichColor)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "currentOrder",
    {
        get = function(self)
            return GetUnitCurrentOrder(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "defaultAcquireRange",
    {
        get = function(self)
            return GetUnitDefaultAcquireRange(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "defaultFlyHeight",
    {
        get = function(self)
            return GetUnitDefaultFlyHeight(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "defaultMoveSpeed",
    {
        get = function(self)
            return GetUnitDefaultMoveSpeed(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "defaultPropWindow",
    {
        get = function(self)
            return GetUnitDefaultPropWindow(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "defaultTurnSpeed",
    {
        get = function(self)
            return GetUnitDefaultTurnSpeed(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "experience",
    {
        get = function(self)
            return GetHeroXP(self.handle)
        end,
        set = function(self, newXpVal)
            SetHeroXP(self.handle, newXpVal, true)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "facing",
    {
        get = function(self)
            return GetUnitFacing(self.handle)
        end,
        set = function(self, value)
            SetUnitFacing(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "foodMade",
    {
        get = function(self)
            return GetUnitFoodMade(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "foodUsed",
    {
        get = function(self)
            return GetUnitFoodUsed(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "ignoreAlarmToggled",
    {
        get = function(self)
            return UnitIgnoreAlarmToggled(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "intelligence",
    {
        get = function(self)
            return GetHeroInt(self.handle, false)
        end,
        set = function(self, value)
            SetHeroInt(self.handle, value, true)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "inventorySize",
    {
        get = function(self)
            return UnitInventorySize(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "invulnerable",
    {
        get = function(self)
            return BlzIsUnitInvulnerable(self.handle)
        end,
        set = function(self, flag)
            SetUnitInvulnerable(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "level",
    {
        get = function(self)
            return GetUnitLevel(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "localZ",
    {
        get = function(self)
            return BlzGetLocalUnitZ(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "mana",
    {
        get = function(self)
            return self:getState(UNIT_STATE_MANA)
        end,
        set = function(self, value)
            self:setState(UNIT_STATE_MANA, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "maxLife",
    {
        get = function(self)
            return BlzGetUnitMaxHP(self.handle)
        end,
        set = function(self, value)
            BlzSetUnitMaxHP(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "maxMana",
    {
        get = function(self)
            return BlzGetUnitMaxMana(self.handle)
        end,
        set = function(self, value)
            BlzSetUnitMaxMana(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "moveSpeed",
    {
        get = function(self)
            return GetUnitMoveSpeed(self.handle)
        end,
        set = function(self, value)
            SetUnitMoveSpeed(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "name",
    {
        get = function(self)
            return GetUnitName(self.handle)
        end,
        set = function(self, value)
            BlzSetUnitName(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "nameProper",
    {
        get = function(self)
            return GetHeroProperName(self.handle)
        end,
        set = function(self, value)
            BlzSetHeroProperName(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "owner",
    {
        get = function(self)
            return MapPlayer:fromHandle(
                GetOwningPlayer(self.handle)
            )
        end,
        set = function(self, whichPlayer)
            SetUnitOwner(self.handle, whichPlayer.handle, true)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "paused",
    {
        get = function(self)
            return IsUnitPaused(self.handle)
        end,
        set = function(self, flag)
            PauseUnit(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "point",
    {
        get = function(self)
            return Point:fromHandle(
                GetUnitLoc(self.handle)
            )
        end,
        set = function(self, whichPoint)
            SetUnitPositionLoc(self.handle, whichPoint.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "pointValue",
    {
        get = function(self)
            return GetUnitPointValue(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "propWindow",
    {
        get = function(self)
            return GetUnitPropWindow(self.handle)
        end,
        set = function(self, value)
            SetUnitPropWindow(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "race",
    {
        get = function(self)
            return GetUnitRace(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "rallyDestructable",
    {
        get = function(self)
            return Destructable:fromHandle(
                GetUnitRallyDestructable(self.handle)
            )
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "rallyPoint",
    {
        get = function(self)
            return Point:fromHandle(
                GetUnitRallyPoint(self.handle)
            )
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "rallyUnit",
    {
        get = function(self)
            return ____exports.Unit:fromHandle(
                GetUnitRallyUnit(self.handle)
            )
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "resourceAmount",
    {
        get = function(self)
            return GetResourceAmount(self.handle)
        end,
        set = function(self, amount)
            SetResourceAmount(self.handle, amount)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "selectable",
    {
        get = function(self)
            return BlzIsUnitSelectable(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "selectionScale",
    {
        get = function(self)
            local result = self:getField(UNIT_RF_SELECTION_SCALE)
            return (((type(result) == "number") and (function() return result end)) or (function() return 0 end))()
        end,
        set = function(self, scale)
            self:setField(UNIT_RF_SELECTION_SCALE, scale)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "show",
    {
        get = function(self)
            return not IsUnitHidden(self.handle)
        end,
        set = function(self, flag)
            ShowUnit(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "skin",
    {
        get = function(self)
            return BlzGetUnitSkin(self.handle)
        end,
        set = function(self, skinId)
            BlzSetUnitSkin(self.handle, skinId)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "skillPoints",
    {
        get = function(self)
            return GetHeroSkillPoints(self.handle)
        end,
        set = function(self, skillPointDelta)
            UnitModifySkillPoints(self.handle, skillPointDelta)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "sleeping",
    {
        get = function(self)
            return UnitIsSleeping(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "strength",
    {
        get = function(self)
            return GetHeroStr(self.handle, false)
        end,
        set = function(self, value)
            SetHeroStr(self.handle, value, true)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "turnSpeed",
    {
        get = function(self)
            return GetUnitTurnSpeed(self.handle)
        end,
        set = function(self, value)
            SetUnitTurnSpeed(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "typeId",
    {
        get = function(self)
            return GetUnitTypeId(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "userData",
    {
        get = function(self)
            return GetUnitUserData(self.handle)
        end,
        set = function(self, value)
            SetUnitUserData(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "waygateActive",
    {
        get = function(self)
            return WaygateIsActive(self.handle)
        end,
        set = function(self, flag)
            WaygateActivate(self.handle, flag)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "x",
    {
        get = function(self)
            return GetUnitX(self.handle)
        end,
        set = function(self, value)
            SetUnitX(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "y",
    {
        get = function(self)
            return GetUnitY(self.handle)
        end,
        set = function(self, value)
            SetUnitY(self.handle, value)
        end
    },
    true
)
__TS__SetDescriptor(
    Unit.prototype,
    "z",
    {
        get = function(self)
            return BlzGetUnitZ(self.handle)
        end
    },
    true
)
function Unit.prototype.addAbility(self, abilityId)
    return UnitAddAbility(self.handle, abilityId)
end
function Unit.prototype.addAnimationProps(self, animProperties, add)
    AddUnitAnimationProperties(self.handle, animProperties, add)
end
function Unit.prototype.addExperience(self, xpToAdd, showEyeCandy)
    AddHeroXP(self.handle, xpToAdd, showEyeCandy)
end
function Unit.prototype.addIndicator(self, red, blue, green, alpha)
    UnitAddIndicator(self.handle, red, blue, green, alpha)
end
function Unit.prototype.addItem(self, whichItem)
    return UnitAddItem(self.handle, whichItem.handle)
end
function Unit.prototype.addItemById(self, itemId)
    return Item:fromHandle(
        UnitAddItemById(self.handle, itemId)
    )
end
function Unit.prototype.addItemToSlotById(self, itemId, itemSlot)
    return UnitAddItemToSlotById(self.handle, itemId, itemSlot)
end
function Unit.prototype.addItemToStock(self, itemId, currentStock, stockMax)
    AddItemToStock(self.handle, itemId, currentStock, stockMax)
end
function Unit.prototype.addResourceAmount(self, amount)
    AddResourceAmount(self.handle, amount)
end
function Unit.prototype.addSleepPerm(self, add)
    UnitAddSleepPerm(self.handle, add)
end
function Unit.prototype.addType(self, whichUnitType)
    return UnitAddType(self.handle, whichUnitType)
end
function Unit.prototype.addUnitToStock(self, unitId, currentStock, stockMax)
    AddUnitToStock(self.handle, unitId, currentStock, stockMax)
end
function Unit.prototype.applyTimedLife(self, buffId, duration)
    UnitApplyTimedLife(self.handle, buffId, duration)
end
function Unit.prototype.attachSound(self, sound)
    AttachSoundToUnit(sound.handle, self.handle)
end
function Unit.prototype.cancelTimedLife(self)
    BlzUnitCancelTimedLife(self.handle)
end
function Unit.prototype.canSleepPerm(self)
    return UnitCanSleepPerm(self.handle)
end
function Unit.prototype.countBuffs(self, removePositive, removeNegative, magic, physical, timedLife, aura, autoDispel)
    return UnitCountBuffsEx(self.handle, removePositive, removeNegative, magic, physical, timedLife, aura, autoDispel)
end
function Unit.prototype.damageAt(self, delay, radius, x, y, amount, attack, ranged, attackType, damageType, weaponType)
    return UnitDamagePoint(self.handle, delay, radius, x, y, amount, attack, ranged, attackType, damageType, weaponType)
end
function Unit.prototype.damageTarget(self, target, amount, attack, ranged, attackType, damageType, weaponType)
    return UnitDamageTarget(self.handle, target, amount, attack, ranged, attackType, damageType, weaponType)
end
function Unit.prototype.decAbilityLevel(self, abilCode)
    return DecUnitAbilityLevel(self.handle, abilCode)
end
function Unit.prototype.destroy(self)
    RemoveUnit(self.handle)
end
function Unit.prototype.disableAbility(self, abilId, flag, hideUI)
    BlzUnitDisableAbility(self.handle, abilId, flag, hideUI)
end
function Unit.prototype.dropItem(self, whichItem, x, y)
    return UnitDropItemPoint(self.handle, whichItem.handle, x, y)
end
function Unit.prototype.dropItemFromSlot(self, whichItem, slot)
    return UnitDropItemSlot(self.handle, whichItem.handle, slot)
end
function Unit.prototype.dropItemTarget(self, whichItem, target)
    return UnitDropItemTarget(self.handle, whichItem.handle, target.handle)
end
function Unit.prototype.endAbilityCooldown(self, abilCode)
    BlzEndUnitAbilityCooldown(self.handle, abilCode)
end
function Unit.prototype.getAbility(self, abilId)
    return BlzGetUnitAbility(self.handle, abilId)
end
function Unit.prototype.getAbilityByIndex(self, index)
    return BlzGetUnitAbilityByIndex(self.handle, index)
end
function Unit.prototype.getAbilityCooldown(self, abilId, level)
    return BlzGetUnitAbilityCooldown(self.handle, abilId, level)
end
function Unit.prototype.getAbilityCooldownRemaining(self, abilId)
    return BlzGetUnitAbilityCooldownRemaining(self.handle, abilId)
end
function Unit.prototype.getAbilityLevel(self, abilCode)
    return GetUnitAbilityLevel(self.handle, abilCode)
end
function Unit.prototype.getAbilityManaCost(self, abilId, level)
    return BlzGetUnitAbilityManaCost(self.handle, abilId, level)
end
function Unit.prototype.getAgility(self, includeBonuses)
    return GetHeroAgi(self.handle, includeBonuses)
end
function Unit.prototype.getAttackCooldown(self, weaponIndex)
    return BlzGetUnitAttackCooldown(self.handle, weaponIndex)
end
function Unit.prototype.getBaseDamage(self, weaponIndex)
    return BlzGetUnitBaseDamage(self.handle, weaponIndex)
end
function Unit.prototype.getDiceNumber(self, weaponIndex)
    return BlzGetUnitDiceNumber(self.handle, weaponIndex)
end
function Unit.prototype.getDiceSides(self, weaponIndex)
    return BlzGetUnitDiceSides(self.handle, weaponIndex)
end
function Unit.prototype.getField(self, field)
    local fieldType = __TS__StringSubstr(
        tostring(field),
        0,
        (string.find(
            tostring(field),
            ":",
            nil,
            true
        ) or 0) - 1
    )
    local ____switch124 = fieldType
    local fieldBool, fieldInt, fieldReal, fieldString
    if ____switch124 == "unitbooleanfield" then
        goto ____switch124_case_0
    elseif ____switch124 == "unitintegerfield" then
        goto ____switch124_case_1
    elseif ____switch124 == "unitrealfield" then
        goto ____switch124_case_2
    elseif ____switch124 == "unitstringfield" then
        goto ____switch124_case_3
    end
    goto ____switch124_case_default
    ::____switch124_case_0::
    do
        fieldBool = field
        return BlzGetUnitBooleanField(self.handle, fieldBool)
    end
    ::____switch124_case_1::
    do
        fieldInt = field
        return BlzGetUnitIntegerField(self.handle, fieldInt)
    end
    ::____switch124_case_2::
    do
        fieldReal = field
        return BlzGetUnitRealField(self.handle, fieldReal)
    end
    ::____switch124_case_3::
    do
        fieldString = field
        return BlzGetUnitStringField(self.handle, fieldString)
    end
    ::____switch124_case_default::
    do
        return 0
    end
    ::____switch124_end::
end
function Unit.prototype.getflyHeight(self)
    return GetUnitFlyHeight(self.handle)
end
function Unit.prototype.getHeroLevel(self)
    return GetHeroLevel(self.handle)
end
function Unit.prototype.getIgnoreAlarm(self, flag)
    return UnitIgnoreAlarm(self.handle, flag)
end
function Unit.prototype.getIntelligence(self, includeBonuses)
    return GetHeroInt(self.handle, includeBonuses)
end
function Unit.prototype.getItemInSlot(self, slot)
    return Item:fromHandle(
        UnitItemInSlot(self.handle, slot)
    )
end
function Unit.prototype.getState(self, whichUnitState)
    return GetUnitState(self.handle, whichUnitState)
end
function Unit.prototype.getStrength(self, includeBonuses)
    return GetHeroStr(self.handle, includeBonuses)
end
function Unit.prototype.hasBuffs(self, removePositive, removeNegative, magic, physical, timedLife, aura, autoDispel)
    return UnitHasBuffsEx(self.handle, removePositive, removeNegative, magic, physical, timedLife, aura, autoDispel)
end
function Unit.prototype.hasItem(self, whichItem)
    return UnitHasItem(self.handle, whichItem.handle)
end
function Unit.prototype.hideAbility(self, abilId, flag)
    BlzUnitHideAbility(self.handle, abilId, flag)
end
function Unit.prototype.incAbilityLevel(self, abilCode)
    return IncUnitAbilityLevel(self.handle, abilCode)
end
function Unit.prototype.inForce(self, whichForce)
    return IsUnitInForce(self.handle, whichForce.handle)
end
function Unit.prototype.inGroup(self, whichGroup)
    return IsUnitInGroup(self.handle, whichGroup.handle)
end
function Unit.prototype.inRange(self, x, y, distance)
    return IsUnitInRangeXY(self.handle, x, y, distance)
end
function Unit.prototype.inRangeOfPoint(self, whichPoint, distance)
    return IsUnitInRangeLoc(self.handle, whichPoint.handle, distance)
end
function Unit.prototype.inRangeOfUnit(self, otherUnit, distance)
    return IsUnitInRange(self.handle, otherUnit.handle, distance)
end
function Unit.prototype.interruptAttack(self)
    BlzUnitInterruptAttack(self.handle)
end
function Unit.prototype.inTransport(self, whichTransport)
    return IsUnitInTransport(self.handle, whichTransport.handle)
end
function Unit.prototype.isAlive(self)
    return UnitAlive(self.handle)
end
function Unit.prototype.isAlly(self, whichPlayer)
    return IsUnitAlly(self.handle, whichPlayer.handle)
end
function Unit.prototype.isEnemy(self, whichPlayer)
    return IsUnitEnemy(self.handle, whichPlayer.handle)
end
function Unit.prototype.isExperienceSuspended(self)
    return IsSuspendedXP(self.handle)
end
function Unit.prototype.isFogged(self, whichPlayer)
    return IsUnitFogged(self.handle, whichPlayer.handle)
end
function Unit.prototype.isHero(self)
    return IsHeroUnitId(self.typeId)
end
function Unit.prototype.isIllusion(self)
    return IsUnitIllusion(self.handle)
end
function Unit.prototype.isLoaded(self)
    return IsUnitLoaded(self.handle)
end
function Unit.prototype.isMasked(self, whichPlayer)
    return IsUnitMasked(self.handle, whichPlayer.handle)
end
function Unit.prototype.isSelected(self, whichPlayer)
    return IsUnitSelected(self.handle, whichPlayer.handle)
end
function Unit.prototype.issueBuildOrder(self, unit, x, y)
    return (((type(unit) == "string") and (function() return IssueBuildOrder(self.handle, unit, x, y) end)) or (function() return IssueBuildOrderById(self.handle, unit, x, y) end))()
end
function Unit.prototype.issueImmediateOrder(self, order)
    return (((type(order) == "string") and (function() return IssueImmediateOrder(self.handle, order) end)) or (function() return IssueImmediateOrderById(self.handle, order) end))()
end
function Unit.prototype.issueInstantOrderAt(self, order, x, y, instantTargetWidget)
    return (((type(order) == "string") and (function() return IssueInstantPointOrder(self.handle, order, x, y, instantTargetWidget.handle) end)) or (function() return IssueInstantPointOrderById(self.handle, order, x, y, instantTargetWidget.handle) end))()
end
function Unit.prototype.issueInstantTargetOrder(self, order, targetWidget, instantTargetWidget)
    return (((type(order) == "string") and (function() return IssueInstantTargetOrder(self.handle, order, targetWidget.handle, instantTargetWidget.handle) end)) or (function() return IssueInstantTargetOrderById(self.handle, order, targetWidget.handle, instantTargetWidget.handle) end))()
end
function Unit.prototype.issueOrderAt(self, order, x, y)
    return (((type(order) == "string") and (function() return IssuePointOrder(self.handle, order, x, y) end)) or (function() return IssuePointOrderById(self.handle, order, x, y) end))()
end
function Unit.prototype.issuePointOrder(self, order, whichPoint)
    return (((type(order) == "string") and (function() return IssuePointOrderLoc(self.handle, order, whichPoint.handle) end)) or (function() return IssuePointOrderByIdLoc(self.handle, order, whichPoint.handle) end))()
end
function Unit.prototype.issueTargetOrder(self, order, targetWidget)
    return (((type(order) == "string") and (function() return IssueTargetOrder(self.handle, order, targetWidget.handle) end)) or (function() return IssueTargetOrderById(self.handle, order, targetWidget.handle) end))()
end
function Unit.prototype.isUnit(self, whichSpecifiedUnit)
    return IsUnit(self.handle, whichSpecifiedUnit.handle)
end
function Unit.prototype.isUnitType(self, whichUnitType)
    return IsUnitType(self.handle, whichUnitType)
end
function Unit.prototype.isVisible(self, whichPlayer)
    return IsUnitVisible(self.handle, whichPlayer.handle)
end
function Unit.prototype.kill(self)
    KillUnit(self.handle)
end
function Unit.prototype.lookAt(self, whichBone, lookAtTarget, offsetX, offsetY, offsetZ)
    SetUnitLookAt(self.handle, whichBone, lookAtTarget.handle, offsetX, offsetY, offsetZ)
end
function Unit.prototype.makeAbilityPermanent(self, permanent, abilityId)
    UnitMakeAbilityPermanent(self.handle, permanent, abilityId)
end
function Unit.prototype.modifySkillPoints(self, skillPointDelta)
    return UnitModifySkillPoints(self.handle, skillPointDelta)
end
function Unit.prototype.pauseEx(self, flag)
    BlzPauseUnitEx(self.handle, flag)
end
function Unit.prototype.pauseTimedLife(self, flag)
    UnitPauseTimedLife(self.handle, flag)
end
function Unit.prototype.queueAnimation(self, whichAnimation)
    QueueUnitAnimation(self.handle, whichAnimation)
end
function Unit.prototype.recycleGuardPosition(self)
    RecycleGuardPosition(self.handle)
end
function Unit.prototype.removeAbility(self, abilityId)
    return UnitRemoveAbility(self.handle, abilityId)
end
function Unit.prototype.removeBuffs(self, removePositive, removeNegative)
    UnitRemoveBuffs(self.handle, removePositive, removeNegative)
end
function Unit.prototype.removeBuffsEx(self, removePositive, removeNegative, magic, physical, timedLife, aura, autoDispel)
    UnitRemoveBuffsEx(self.handle, removePositive, removeNegative, magic, physical, timedLife, aura, autoDispel)
end
function Unit.prototype.removeGuardPosition(self)
    RemoveGuardPosition(self.handle)
end
function Unit.prototype.removeItem(self, whichItem)
    UnitRemoveItem(self.handle, whichItem.handle)
end
function Unit.prototype.removeItemFromSlot(self, itemSlot)
    return Item:fromHandle(
        UnitRemoveItemFromSlot(self.handle, itemSlot)
    )
end
function Unit.prototype.removeItemFromStock(self, itemId)
    RemoveItemFromStock(self.handle, itemId)
end
function Unit.prototype.removeType(self, whichUnitType)
    return UnitAddType(self.handle, whichUnitType)
end
function Unit.prototype.removeUnitFromStock(self, itemId)
    RemoveUnitFromStock(self.handle, itemId)
end
function Unit.prototype.resetCooldown(self)
    UnitResetCooldown(self.handle)
end
function Unit.prototype.resetLookAt(self)
    ResetUnitLookAt(self.handle)
end
function Unit.prototype.revive(self, x, y, doEyecandy)
    return ReviveHero(self.handle, x, y, doEyecandy)
end
function Unit.prototype.reviveAtPoint(self, whichPoint, doEyecandy)
    return ReviveHeroLoc(self.handle, whichPoint.handle, doEyecandy)
end
function Unit.prototype.select(self, flag)
    SelectUnit(self.handle, flag)
end
function Unit.prototype.selectSkill(self, abilCode)
    SelectHeroSkill(self.handle, abilCode)
end
function Unit.prototype.setAbilityCooldown(self, abilId, level, cooldown)
    BlzSetUnitAbilityCooldown(self.handle, abilId, level, cooldown)
end
function Unit.prototype.setAbilityLevel(self, abilCode, level)
    return SetUnitAbilityLevel(self.handle, abilCode, level)
end
function Unit.prototype.setAbilityManaCost(self, abilId, level, manaCost)
    BlzSetUnitAbilityManaCost(self.handle, abilId, level, manaCost)
end
function Unit.prototype.setAgility(self, value, permanent)
    SetHeroAgi(self.handle, value, permanent)
end
function Unit.prototype.setAnimation(self, whichAnimation)
    if type(whichAnimation) == "string" then
        SetUnitAnimation(self.handle, whichAnimation)
    else
        SetUnitAnimationByIndex(self.handle, whichAnimation)
    end
end
function Unit.prototype.setAnimationWithRarity(self, whichAnimation, rarity)
    SetUnitAnimationWithRarity(self.handle, whichAnimation, rarity)
end
function Unit.prototype.setAttackCooldown(self, cooldown, weaponIndex)
    BlzSetUnitAttackCooldown(self.handle, cooldown, weaponIndex)
end
function Unit.prototype.setBaseDamage(self, baseDamage, weaponIndex)
    BlzSetUnitBaseDamage(self.handle, baseDamage, weaponIndex)
end
function Unit.prototype.setBlendTime(self, timeScale)
    SetUnitBlendTime(self.handle, timeScale)
end
function Unit.prototype.setConstructionProgress(self, constructionPercentage)
    UnitSetConstructionProgress(self.handle, constructionPercentage)
end
function Unit.prototype.setCreepGuard(self, creepGuard)
    SetUnitCreepGuard(self.handle, creepGuard)
end
function Unit.prototype.setDiceNumber(self, diceNumber, weaponIndex)
    BlzSetUnitDiceNumber(self.handle, diceNumber, weaponIndex)
end
function Unit.prototype.setDiceSides(self, diceSides, weaponIndex)
    BlzSetUnitDiceSides(self.handle, diceSides, weaponIndex)
end
function Unit.prototype.setExperience(self, newXpVal, showEyeCandy)
    SetHeroXP(self.handle, newXpVal, showEyeCandy)
end
function Unit.prototype.setExploded(self, exploded)
    SetUnitExploded(self.handle, exploded)
end
function Unit.prototype.setFacingEx(self, facingAngle)
    BlzSetUnitFacingEx(self.handle, facingAngle)
end
function Unit.prototype.setField(self, field, value)
    local fieldType = __TS__StringSubstr(
        tostring(field),
        0,
        (string.find(
            tostring(field),
            ":",
            nil,
            true
        ) or 0) - 1
    )
    if (fieldType == "unitbooleanfield") and (type(value) == "boolean") then
        return BlzSetUnitBooleanField(self.handle, field, value)
    elseif (fieldType == "unitintegerfield") and (type(value) == "number") then
        return BlzSetUnitIntegerField(self.handle, field, value)
    elseif (fieldType == "unitrealfield") and (type(value) == "number") then
        return BlzSetUnitRealField(self.handle, field, value)
    elseif (fieldType == "unitstringfield") and (type(value) == "string") then
        return BlzSetUnitStringField(self.handle, field, value)
    end
    return false
end
function Unit.prototype.setflyHeight(self, value, rate)
    SetUnitFlyHeight(self.handle, value, rate)
end
function Unit.prototype.setHeroLevel(self, level, showEyeCandy)
    SetHeroLevel(self.handle, level, showEyeCandy)
end
function Unit.prototype.setIntelligence(self, value, permanent)
    SetHeroInt(self.handle, value, permanent)
end
function Unit.prototype.setItemTypeSlots(self, slots)
    SetItemTypeSlots(self.handle, slots)
end
function Unit.prototype.setOwner(self, whichPlayer, changeColor)
    SetUnitOwner(self.handle, whichPlayer.handle, changeColor)
end
function Unit.prototype.setPathing(self, flag)
    SetUnitPathing(self.handle, flag)
end
function Unit.prototype.setPosition(self, x, y)
    SetUnitPosition(self.handle, x, y)
end
function Unit.prototype.setRescuable(self, byWhichPlayer, flag)
    SetUnitRescuable(self.handle, byWhichPlayer.handle, flag)
end
function Unit.prototype.setRescueRange(self, range)
    SetUnitRescueRange(self.handle, range)
end
function Unit.prototype.setScale(self, scaleX, scaleY, scaleZ)
    SetUnitScale(self.handle, scaleX, scaleY, scaleZ)
end
function Unit.prototype.setState(self, whichUnitState, newVal)
    SetUnitState(self.handle, whichUnitState, newVal)
end
function Unit.prototype.setStrength(self, value, permanent)
    SetHeroStr(self.handle, value, permanent)
end
function Unit.prototype.setTimeScale(self, timeScale)
    SetUnitTimeScale(self.handle, timeScale)
end
function Unit.prototype.setUnitAttackCooldown(self, cooldown, weaponIndex)
    BlzSetUnitAttackCooldown(self.handle, cooldown, weaponIndex)
end
function Unit.prototype.setUnitTypeSlots(self, slots)
    SetUnitTypeSlots(self.handle, slots)
end
function Unit.prototype.setUpgradeProgress(self, upgradePercentage)
    UnitSetUpgradeProgress(self.handle, upgradePercentage)
end
function Unit.prototype.setUseAltIcon(self, flag)
    UnitSetUsesAltIcon(self.handle, flag)
end
function Unit.prototype.setUseFood(self, useFood)
    SetUnitUseFood(self.handle, useFood)
end
function Unit.prototype.setVertexColor(self, red, green, blue, alpha)
    SetUnitVertexColor(self.handle, red, green, blue, alpha)
end
function Unit.prototype.shareVision(self, whichPlayer, share)
    UnitShareVision(self.handle, whichPlayer.handle, share)
end
function Unit.prototype.showTeamGlow(self, show)
    BlzShowUnitTeamGlow(self.handle, show)
end
function Unit.prototype.startAbilityCooldown(self, abilCode, cooldown)
    BlzStartUnitAbilityCooldown(self.handle, abilCode, cooldown)
end
function Unit.prototype.stripLevels(self, howManyLevels)
    return UnitStripHeroLevel(self.handle, howManyLevels)
end
function Unit.prototype.suspendDecay(self, suspend)
    UnitSuspendDecay(self.handle, suspend)
end
function Unit.prototype.suspendExperience(self, flag)
    SuspendHeroXP(self.handle, flag)
end
function Unit.prototype.useItem(self, whichItem)
    return UnitUseItem(self.handle, whichItem.handle)
end
function Unit.prototype.useItemAt(self, whichItem, x, y)
    return UnitUseItemPoint(self.handle, whichItem.handle, x, y)
end
function Unit.prototype.useItemTarget(self, whichItem, target)
    return UnitUseItemTarget(self.handle, whichItem.handle, target.handle)
end
function Unit.prototype.wakeUp(self)
    UnitWakeUp(self.handle)
end
function Unit.prototype.waygateGetDestinationX(self)
    return WaygateGetDestinationX(self.handle)
end
function Unit.prototype.waygateGetDestinationY(self)
    return WaygateGetDestinationY(self.handle)
end
function Unit.prototype.waygateSetDestination(self, x, y)
    WaygateSetDestination(self.handle, x, y)
end
function Unit.foodMadeByType(self, unitId)
    return GetFoodMade(unitId)
end
function Unit.foodUsedByType(self, unitId)
    return GetFoodUsed(unitId)
end
function Unit.fromEnum(self)
    return self:fromHandle(
        GetEnumUnit()
    )
end
function Unit.fromEvent(self)
    return self:fromHandle(
        GetTriggerUnit()
    )
end
function Unit.fromFilter(self)
    return self:fromHandle(
        GetFilterUnit()
    )
end
function Unit.fromHandle(self, handle)
    return self:getObject(handle)
end
function Unit.getPointValueByType(self, unitType)
    return GetUnitPointValueByType(unitType)
end
function Unit.isUnitIdHero(self, unitId)
    return IsHeroUnitId(unitId)
end
function Unit.isUnitIdType(self, unitId, whichUnitType)
    return IsUnitIdType(unitId, whichUnitType)
end
return ____exports
end,
["node_modules.w3ts.handles.group"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
local ____unit = require("node_modules.w3ts.handles.unit")
local Unit = ____unit.Unit
____exports.Group = __TS__Class()
local Group = ____exports.Group
Group.name = "Group"
__TS__ClassExtends(Group, Handle)
function Group.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateGroup()
        )
    end
end
__TS__SetDescriptor(
    Group.prototype,
    "first",
    {
        get = function(self)
            return Unit:fromHandle(
                FirstOfGroup(self.handle)
            )
        end
    },
    true
)
__TS__SetDescriptor(
    Group.prototype,
    "size",
    {
        get = function(self)
            return BlzGroupGetSize(self.handle)
        end
    },
    true
)
function Group.prototype.addGroupFast(self, addGroup)
    return BlzGroupAddGroupFast(self.handle, addGroup.handle)
end
function Group.prototype.addUnit(self, whichUnit)
    return GroupAddUnit(self.handle, whichUnit.handle)
end
function Group.prototype.clear(self)
    GroupClear(self.handle)
end
function Group.prototype.destroy(self)
    DestroyGroup(self.handle)
end
function Group.prototype.enumUnitsInRange(self, x, y, radius, filter)
    GroupEnumUnitsInRange(
        self.handle,
        x,
        y,
        radius,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Group.prototype.enumUnitsInRangeCounted(self, x, y, radius, filter, countLimit)
    GroupEnumUnitsInRangeCounted(
        self.handle,
        x,
        y,
        radius,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))(),
        countLimit
    )
end
function Group.prototype.enumUnitsInRangeOfPoint(self, whichPoint, radius, filter)
    GroupEnumUnitsInRangeOfLoc(
        self.handle,
        whichPoint.handle,
        radius,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Group.prototype.enumUnitsInRangeOfPointCounted(self, whichPoint, radius, filter, countLimit)
    GroupEnumUnitsInRangeOfLocCounted(
        self.handle,
        whichPoint.handle,
        radius,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))(),
        countLimit
    )
end
function Group.prototype.enumUnitsInRect(self, r, filter)
    GroupEnumUnitsInRect(
        self.handle,
        r.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Group.prototype.enumUnitsInRectCounted(self, r, filter, countLimit)
    GroupEnumUnitsInRectCounted(
        self.handle,
        r.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))(),
        countLimit
    )
end
function Group.prototype.enumUnitsOfPlayer(self, whichPlayer, filter)
    GroupEnumUnitsOfPlayer(
        self.handle,
        whichPlayer.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Group.prototype.enumUnitsOfType(self, unitName, filter)
    GroupEnumUnitsOfType(
        self.handle,
        unitName,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Group.prototype.enumUnitsOfTypeCounted(self, unitName, filter, countLimit)
    GroupEnumUnitsOfTypeCounted(
        self.handle,
        unitName,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))(),
        countLimit
    )
end
function Group.prototype.enumUnitsSelected(self, whichPlayer, filter)
    GroupEnumUnitsSelected(
        self.handle,
        whichPlayer.handle,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
Group.prototype["for"] = function(self, callback)
    ForGroup(self.handle, callback)
end
function Group.prototype.getUnits(self)
    local units = {}
    self["for"](
        self,
        function() return __TS__ArrayPush(
            units,
            Unit:fromFilter()
        ) end
    )
    return units
end
function Group.prototype.getUnitAt(self, index)
    return Unit:fromHandle(
        BlzGroupUnitAt(self.handle, index)
    )
end
function Group.prototype.hasUnit(self, whichUnit)
    return IsUnitInGroup(whichUnit.handle, self.handle)
end
function Group.prototype.orderCoords(self, order, x, y)
    if type(order) == "string" then
        GroupPointOrder(self.handle, order, x, y)
    else
        GroupPointOrderById(self.handle, order, x, y)
    end
end
function Group.prototype.orderImmediate(self, order)
    if type(order) == "string" then
        GroupImmediateOrder(self.handle, order)
    else
        GroupImmediateOrderById(self.handle, order)
    end
end
function Group.prototype.orderPoint(self, order, whichPoint)
    if type(order) == "string" then
        GroupPointOrderLoc(self.handle, order, whichPoint.handle)
    else
        GroupPointOrderByIdLoc(self.handle, order, whichPoint.handle)
    end
end
function Group.prototype.orderTarget(self, order, targetWidget)
    if type(order) == "string" then
        GroupTargetOrder(self.handle, order, targetWidget.handle)
    else
        GroupTargetOrderById(self.handle, order, targetWidget.handle)
    end
end
function Group.prototype.removeGroupFast(self, removeGroup)
    return BlzGroupRemoveGroupFast(self.handle, removeGroup.handle)
end
function Group.prototype.removeUnit(self, whichUnit)
    return GroupRemoveUnit(self.handle, whichUnit.handle)
end
function Group.fromHandle(self, handle)
    return self:getObject(handle)
end
function Group.getEnumUnit(self)
    return Unit:fromHandle(
        GetEnumUnit()
    )
end
function Group.getFilterUnit(self)
    return Unit:fromHandle(
        GetFilterUnit()
    )
end
return ____exports
end,
["node_modules.w3ts.handles.image"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.ImageType = {}
____exports.ImageType.Selection = 1
____exports.ImageType[____exports.ImageType.Selection] = "Selection"
____exports.ImageType.Indicator = 2
____exports.ImageType[____exports.ImageType.Indicator] = "Indicator"
____exports.ImageType.OcclusionMask = 3
____exports.ImageType[____exports.ImageType.OcclusionMask] = "OcclusionMask"
____exports.ImageType.Ubersplat = 4
____exports.ImageType[____exports.ImageType.Ubersplat] = "Ubersplat"
____exports.Image = __TS__Class()
local Image = ____exports.Image
Image.name = "Image"
__TS__ClassExtends(Image, Handle)
function Image.prototype.____constructor(self, file, sizeX, sizeY, sizeZ, posX, posY, posZ, originX, originY, originZ, imageType)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateImage(file, sizeX, sizeY, sizeZ, posX, posY, posZ, originX, originY, originZ, imageType)
        )
    end
end
function Image.prototype.destroy(self)
    DestroyImage(self.handle)
end
function Image.prototype.setAboveWater(self, flag, useWaterAlpha)
    SetImageAboveWater(self.handle, flag, useWaterAlpha)
end
function Image.prototype.setColor(self, red, green, blue, alpha)
    SetImageColor(self.handle, red, green, blue, alpha)
end
function Image.prototype.setConstantHeight(self, flag, height)
    SetImageConstantHeight(self.handle, flag, height)
end
function Image.prototype.setPosition(self, x, y, z)
    SetImagePosition(self.handle, x, y, z)
end
function Image.prototype.setRender(self, flag)
    SetImageRenderAlways(self.handle, flag)
end
function Image.prototype.setType(self, imageType)
    SetImageType(self.handle, imageType)
end
function Image.prototype.show(self, flag)
    ShowImage(self.handle, flag)
end
function Image.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.leaderboard"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Leaderboard = __TS__Class()
local Leaderboard = ____exports.Leaderboard
Leaderboard.name = "Leaderboard"
__TS__ClassExtends(Leaderboard, Handle)
function Leaderboard.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateLeaderboard()
        )
    end
end
__TS__SetDescriptor(
    Leaderboard.prototype,
    "displayed",
    {
        get = function(self)
            return IsLeaderboardDisplayed(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Leaderboard.prototype,
    "itemCount",
    {
        get = function(self)
            return LeaderboardGetItemCount(self.handle)
        end,
        set = function(self, count)
            LeaderboardSetSizeByItemCount(self.handle, count)
        end
    },
    true
)
__TS__SetDescriptor(
    Leaderboard.prototype,
    "label",
    {
        get = function(self)
            return LeaderboardGetLabelText(self.handle)
        end,
        set = function(self, value)
            LeaderboardSetLabel(self.handle, value)
        end
    },
    true
)
function Leaderboard.prototype.addItem(self, label, value, p)
    LeaderboardAddItem(self.handle, label, value, p.handle)
end
function Leaderboard.prototype.clear(self)
    LeaderboardClear(self.handle)
end
function Leaderboard.prototype.destroy(self)
    DestroyLeaderboard(self.handle)
end
function Leaderboard.prototype.display(self, flag)
    if flag == nil then
        flag = true
    end
    LeaderboardDisplay(self.handle, flag)
end
function Leaderboard.prototype.getPlayerIndex(self, p)
    return LeaderboardGetPlayerIndex(self.handle, p.handle)
end
function Leaderboard.prototype.hasPlayerItem(self, p)
    LeaderboardHasPlayerItem(self.handle, p.handle)
end
function Leaderboard.prototype.removeItem(self, index)
    LeaderboardRemoveItem(self.handle, index)
end
function Leaderboard.prototype.removePlayerItem(self, p)
    LeaderboardRemovePlayerItem(self.handle, p.handle)
end
function Leaderboard.prototype.setItemLabel(self, item, label)
    LeaderboardSetItemLabel(self.handle, item, label)
end
function Leaderboard.prototype.setItemLabelColor(self, item, red, green, blue, alpha)
    LeaderboardSetItemLabelColor(self.handle, item, red, green, blue, alpha)
end
function Leaderboard.prototype.setItemStyle(self, item, showLabel, showValues, showIcons)
    if showLabel == nil then
        showLabel = true
    end
    if showValues == nil then
        showValues = true
    end
    if showIcons == nil then
        showIcons = true
    end
    LeaderboardSetItemStyle(self.handle, item, showLabel, showValues, showIcons)
end
function Leaderboard.prototype.setItemValue(self, item, value)
    LeaderboardSetItemValue(self.handle, item, value)
end
function Leaderboard.prototype.setItemValueColor(self, item, red, green, blue, alpha)
    LeaderboardSetItemValueColor(self.handle, item, red, green, blue, alpha)
end
function Leaderboard.prototype.setLabelColor(self, red, green, blue, alpha)
    LeaderboardSetLabelColor(self.handle, red, green, blue, alpha)
end
function Leaderboard.prototype.setPlayerBoard(self, p)
    PlayerSetLeaderboard(p.handle, self.handle)
end
function Leaderboard.prototype.setStyle(self, showLabel, showNames, showValues, showIcons)
    if showLabel == nil then
        showLabel = true
    end
    if showNames == nil then
        showNames = true
    end
    if showValues == nil then
        showValues = true
    end
    if showIcons == nil then
        showIcons = true
    end
    LeaderboardSetStyle(self.handle, showLabel, showNames, showValues, showIcons)
end
function Leaderboard.prototype.setValueColor(self, red, green, blue, alpha)
    LeaderboardSetValueColor(self.handle, red, green, blue, alpha)
end
function Leaderboard.prototype.sortByLabel(self, asc)
    if asc == nil then
        asc = true
    end
    LeaderboardSortItemsByLabel(self.handle, asc)
end
function Leaderboard.prototype.sortByPlayer(self, asc)
    if asc == nil then
        asc = true
    end
    LeaderboardSortItemsByPlayer(self.handle, asc)
end
function Leaderboard.prototype.sortByValue(self, asc)
    if asc == nil then
        asc = true
    end
    LeaderboardSortItemsByValue(self.handle, asc)
end
function Leaderboard.fromHandle(self, handle)
    return self:getObject(handle)
end
function Leaderboard.fromPlayer(self, p)
    return self:fromHandle(
        PlayerGetLeaderboard(p.handle)
    )
end
return ____exports
end,
["node_modules.w3ts.handles.multiboard"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.MultiboardItem = __TS__Class()
local MultiboardItem = ____exports.MultiboardItem
MultiboardItem.name = "MultiboardItem"
__TS__ClassExtends(MultiboardItem, Handle)
function MultiboardItem.prototype.____constructor(self, board, x, y)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            MultiboardGetItem(board.handle, x - 1, y - 1)
        )
    end
end
function MultiboardItem.prototype.destroy(self)
    MultiboardReleaseItem(self.handle)
end
function MultiboardItem.prototype.setIcon(self, icon)
    MultiboardSetItemIcon(self.handle, icon)
end
function MultiboardItem.prototype.setStyle(self, showValue, showIcon)
    MultiboardSetItemStyle(self.handle, showValue, showIcon)
end
function MultiboardItem.prototype.setValue(self, val)
    MultiboardSetItemValue(self.handle, val)
end
function MultiboardItem.prototype.setValueColor(self, red, green, blue, alpha)
    MultiboardSetItemValueColor(self.handle, red, green, blue, alpha)
end
function MultiboardItem.prototype.setWidth(self, width)
    MultiboardSetItemWidth(self.handle, width)
end
function MultiboardItem.fromHandle(self, handle)
    return self:getObject(handle)
end
____exports.Multiboard = __TS__Class()
local Multiboard = ____exports.Multiboard
Multiboard.name = "Multiboard"
__TS__ClassExtends(Multiboard, Handle)
function Multiboard.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateMultiboard()
        )
    end
end
__TS__SetDescriptor(
    Multiboard.prototype,
    "columns",
    {
        get = function(self)
            return MultiboardGetColumnCount(self.handle)
        end,
        set = function(self, count)
            MultiboardSetColumnCount(self.handle, count)
        end
    },
    true
)
__TS__SetDescriptor(
    Multiboard.prototype,
    "displayed",
    {
        get = function(self)
            return IsMultiboardDisplayed(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Multiboard.prototype,
    "rows",
    {
        get = function(self)
            return MultiboardGetRowCount(self.handle)
        end,
        set = function(self, count)
            MultiboardSetRowCount(self.handle, count)
        end
    },
    true
)
__TS__SetDescriptor(
    Multiboard.prototype,
    "title",
    {
        get = function(self)
            return MultiboardGetTitleText(self.handle)
        end,
        set = function(self, label)
            MultiboardSetTitleText(self.handle, label)
        end
    },
    true
)
function Multiboard.prototype.clear(self)
    MultiboardClear(self.handle)
end
function Multiboard.prototype.createItem(self, x, y)
    return __TS__New(____exports.MultiboardItem, self, x, y)
end
function Multiboard.prototype.destroy(self)
    DestroyMultiboard(self.handle)
end
function Multiboard.prototype.display(self, show)
    MultiboardDisplay(self.handle, show)
end
function Multiboard.prototype.minimize(self, flag)
    MultiboardMinimize(self.handle, flag)
end
function Multiboard.prototype.minimized(self)
    return IsMultiboardMinimized(self.handle)
end
function Multiboard.prototype.setItemsIcons(self, icon)
    MultiboardSetItemsIcon(self.handle, icon)
end
function Multiboard.prototype.setItemsStyle(self, showValues, showIcons)
    MultiboardSetItemsStyle(self.handle, showValues, showIcons)
end
function Multiboard.prototype.setItemsValue(self, value)
    MultiboardSetItemsValue(self.handle, value)
end
function Multiboard.prototype.setItemsValueColor(self, red, green, blue, alpha)
    MultiboardSetItemsValueColor(self.handle, red, green, blue, alpha)
end
function Multiboard.prototype.setItemsWidth(self, width)
    MultiboardSetItemsWidth(self.handle, width)
end
function Multiboard.prototype.setTitleTextColor(self, red, green, blue, alpha)
    MultiboardSetTitleTextColor(self.handle, red, green, blue, alpha)
end
function Multiboard.fromHandle(self, handle)
    return self:getObject(handle)
end
function Multiboard.suppressDisplay(self, flag)
    MultiboardSuppressDisplay(flag)
end
return ____exports
end,
["node_modules.w3ts.handles.quest"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.QuestItem = __TS__Class()
local QuestItem = ____exports.QuestItem
QuestItem.name = "QuestItem"
__TS__ClassExtends(QuestItem, Handle)
function QuestItem.prototype.____constructor(self, whichQuest)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            QuestCreateItem(whichQuest.handle)
        )
    end
end
__TS__SetDescriptor(
    QuestItem.prototype,
    "completed",
    {
        get = function(self)
            return IsQuestItemCompleted(self.handle)
        end,
        set = function(self, completed)
            QuestItemSetCompleted(self.handle, completed)
        end
    },
    true
)
function QuestItem.prototype.setDescription(self, description)
    QuestItemSetDescription(self.handle, description)
end
____exports.Quest = __TS__Class()
local Quest = ____exports.Quest
Quest.name = "Quest"
__TS__ClassExtends(Quest, Handle)
function Quest.prototype.____constructor(self)
    Handle.prototype.____constructor(
        self,
        ((Handle:initFromHandle() and (function() return nil end)) or (function() return CreateQuest() end))()
    )
end
__TS__SetDescriptor(
    Quest.prototype,
    "completed",
    {
        get = function(self)
            return IsQuestCompleted(self.handle)
        end,
        set = function(self, completed)
            QuestSetCompleted(self.handle, completed)
        end
    },
    true
)
__TS__SetDescriptor(
    Quest.prototype,
    "discovered",
    {
        get = function(self)
            return IsQuestDiscovered(self.handle)
        end,
        set = function(self, discovered)
            QuestSetDiscovered(self.handle, discovered)
        end
    },
    true
)
__TS__SetDescriptor(
    Quest.prototype,
    "enabled",
    {
        get = function(self)
            return IsQuestEnabled(self.handle)
        end,
        set = function(self, enabled)
            QuestSetEnabled(self.handle, enabled)
        end
    },
    true
)
__TS__SetDescriptor(
    Quest.prototype,
    "failed",
    {
        get = function(self)
            return IsQuestFailed(self.handle)
        end,
        set = function(self, failed)
            QuestSetFailed(self.handle, failed)
        end
    },
    true
)
__TS__SetDescriptor(
    Quest.prototype,
    "required",
    {
        get = function(self)
            return IsQuestRequired(self.handle)
        end,
        set = function(self, required)
            QuestSetRequired(self.handle, required)
        end
    },
    true
)
function Quest.prototype.addItem(self, description)
    local questItem = __TS__New(____exports.QuestItem, self)
    questItem:setDescription(description)
    return questItem
end
function Quest.prototype.destroy(self)
    DestroyQuest(self.handle)
end
function Quest.prototype.setDescription(self, description)
    QuestSetDescription(self.handle, description)
end
function Quest.prototype.setIcon(self, iconPath)
    QuestSetIconPath(self.handle, iconPath)
end
function Quest.prototype.setTitle(self, title)
    QuestSetTitle(self.handle, title)
end
function Quest.flashQuestDialogButton(self)
    FlashQuestDialogButton()
end
function Quest.forceQuestDialogUpdate(self)
    ForceQuestDialogUpdate()
end
function Quest.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.region"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Region = __TS__Class()
local Region = ____exports.Region
Region.name = "Region"
__TS__ClassExtends(Region, Handle)
function Region.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateRegion()
        )
    end
end
function Region.prototype.addCell(self, x, y)
    RegionAddCell(self.handle, x, y)
end
function Region.prototype.addCellPoint(self, whichPoint)
    RegionAddCellAtLoc(self.handle, whichPoint.handle)
end
function Region.prototype.addRect(self, r)
    RegionAddRect(self.handle, r.handle)
end
function Region.prototype.clearCell(self, x, y)
    RegionClearCell(self.handle, x, y)
end
function Region.prototype.clearCellPoint(self, whichPoint)
    RegionClearCellAtLoc(self.handle, whichPoint.handle)
end
function Region.prototype.clearRect(self, r)
    RegionClearRect(self.handle, r.handle)
end
function Region.prototype.containsCoords(self, x, y)
    return IsPointInRegion(self.handle, x, y)
end
function Region.prototype.containsPoint(self, whichPoint)
    IsLocationInRegion(self.handle, whichPoint.handle)
end
function Region.prototype.containsUnit(self, whichUnit)
    return IsUnitInRegion(self.handle, whichUnit.handle)
end
function Region.prototype.destroy(self)
    RemoveRegion(self.handle)
end
function Region.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.texttag"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.TextTag = __TS__Class()
local TextTag = ____exports.TextTag
TextTag.name = "TextTag"
__TS__ClassExtends(TextTag, Handle)
function TextTag.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateTextTag()
        )
    end
end
function TextTag.prototype.destroy(self)
    DestroyTextTag(self.handle)
end
function TextTag.prototype.setAge(self, age)
    SetTextTagAge(self.handle, age)
end
function TextTag.prototype.setColor(self, red, green, blue, alpha)
    SetTextTagColor(self.handle, red, green, blue, alpha)
end
function TextTag.prototype.setFadepoint(self, fadepoint)
    SetTextTagFadepoint(self.handle, fadepoint)
end
function TextTag.prototype.setLifespan(self, lifespan)
    SetTextTagLifespan(self.handle, lifespan)
end
function TextTag.prototype.setPermanent(self, flag)
    SetTextTagPermanent(self.handle, flag)
end
function TextTag.prototype.setPos(self, x, y, heightOffset)
    SetTextTagPos(self.handle, x, y, heightOffset)
end
function TextTag.prototype.setPosUnit(self, u, heightOffset)
    SetTextTagPosUnit(self.handle, u.handle, heightOffset)
end
function TextTag.prototype.setSuspended(self, flag)
    SetTextTagSuspended(self.handle, flag)
end
function TextTag.prototype.setText(self, s, height, adjustHeight)
    if adjustHeight == nil then
        adjustHeight = false
    end
    if adjustHeight then
        height = height * 0.0023
    end
    SetTextTagText(self.handle, s, height)
end
function TextTag.prototype.setVelocity(self, xvel, yvel)
    SetTextTagVelocity(self.handle, xvel, yvel)
end
function TextTag.prototype.setVelocityAngle(self, speed, angle)
    local vel = (speed * 0.071) / 128
    self:setVelocity(
        vel * Cos(angle * bj_DEGTORAD),
        vel * Sin(angle * bj_DEGTORAD)
    )
end
function TextTag.prototype.setVisible(self, flag)
    SetTextTagVisibility(self.handle, flag)
end
function TextTag.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.timer"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Timer = __TS__Class()
local Timer = ____exports.Timer
Timer.name = "Timer"
__TS__ClassExtends(Timer, Handle)
function Timer.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateTimer()
        )
    end
end
__TS__SetDescriptor(
    Timer.prototype,
    "elapsed",
    {
        get = function(self)
            return TimerGetElapsed(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Timer.prototype,
    "remaining",
    {
        get = function(self)
            return TimerGetRemaining(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Timer.prototype,
    "timeout",
    {
        get = function(self)
            return TimerGetTimeout(self.handle)
        end
    },
    true
)
function Timer.prototype.destroy(self)
    DestroyTimer(self.handle)
    return self
end
function Timer.prototype.pause(self)
    PauseTimer(self.handle)
    return self
end
function Timer.prototype.resume(self)
    ResumeTimer(self.handle)
    return self
end
function Timer.prototype.start(self, timeout, periodic, handlerFunc)
    TimerStart(self.handle, timeout, periodic, handlerFunc)
    return self
end
function Timer.fromExpired(self)
    return self:fromHandle(
        GetExpiredTimer()
    )
end
function Timer.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.timerdialog"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.TimerDialog = __TS__Class()
local TimerDialog = ____exports.TimerDialog
TimerDialog.name = "TimerDialog"
__TS__ClassExtends(TimerDialog, Handle)
function TimerDialog.prototype.____constructor(self, t)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateTimerDialog(t.handle)
        )
    end
end
__TS__SetDescriptor(
    TimerDialog.prototype,
    "display",
    {
        get = function(self)
            return IsTimerDialogDisplayed(self.handle)
        end,
        set = function(self, display)
            TimerDialogDisplay(self.handle, display)
        end
    },
    true
)
function TimerDialog.prototype.destroy(self)
    DestroyTimerDialog(self.handle)
end
function TimerDialog.prototype.setSpeed(self, speedMultFactor)
    TimerDialogSetSpeed(self.handle, speedMultFactor)
end
function TimerDialog.prototype.setTimeRemaining(self, value)
    TimerDialogSetRealTimeRemaining(self.handle, value)
end
function TimerDialog.prototype.setTitle(self, title)
    TimerDialogSetTitle(self.handle, title)
end
function TimerDialog.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.trigger"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Trigger = __TS__Class()
local Trigger = ____exports.Trigger
Trigger.name = "Trigger"
__TS__ClassExtends(Trigger, Handle)
function Trigger.prototype.____constructor(self)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateTrigger()
        )
    end
end
__TS__SetDescriptor(
    Trigger.prototype,
    "enabled",
    {
        get = function(self)
            return IsTriggerEnabled(self.handle)
        end,
        set = function(self, flag)
            if flag then
                EnableTrigger(self.handle)
            else
                DisableTrigger(self.handle)
            end
        end
    },
    true
)
__TS__SetDescriptor(
    Trigger.prototype,
    "evalCount",
    {
        get = function(self)
            return GetTriggerEvalCount(self.handle)
        end
    },
    true
)
__TS__ObjectDefineProperty(
    Trigger,
    "eventId",
    {
        get = function(self)
            return GetTriggerEventId()
        end
    }
)
__TS__SetDescriptor(
    Trigger.prototype,
    "execCount",
    {
        get = function(self)
            return GetTriggerExecCount(self.handle)
        end
    },
    true
)
__TS__SetDescriptor(
    Trigger.prototype,
    "waitOnSleeps",
    {
        get = function(self)
            return IsTriggerWaitOnSleeps(self.handle)
        end,
        set = function(self, flag)
            TriggerWaitOnSleeps(self.handle, flag)
        end
    },
    true
)
function Trigger.prototype.addAction(self, actionFunc)
    return TriggerAddAction(self.handle, actionFunc)
end
function Trigger.prototype.addCondition(self, condition)
    return TriggerAddCondition(
        self.handle,
        (((type(condition) == "function") and (function() return Condition(condition) end)) or (function() return condition end))()
    )
end
function Trigger.prototype.destroy(self)
    DestroyTrigger(self.handle)
end
function Trigger.prototype.eval(self)
    return TriggerEvaluate(self.handle)
end
function Trigger.prototype.exec(self)
    return TriggerExecute(self.handle)
end
function Trigger.prototype.registerAnyUnitEvent(self, whichPlayerUnitEvent)
    return TriggerRegisterAnyUnitEventBJ(self.handle, whichPlayerUnitEvent)
end
function Trigger.prototype.registerCommandEvent(self, whichAbility, order)
    return TriggerRegisterCommandEvent(self.handle, whichAbility, order)
end
function Trigger.prototype.registerDeathEvent(self, whichWidget)
    return TriggerRegisterDeathEvent(self.handle, whichWidget.handle)
end
function Trigger.prototype.registerDialogButtonEvent(self, whichButton)
    return TriggerRegisterDialogButtonEvent(self.handle, whichButton.handle)
end
function Trigger.prototype.registerDialogEvent(self, whichDialog)
    return TriggerRegisterDialogEvent(self.handle, whichDialog.handle)
end
function Trigger.prototype.registerEnterRegion(self, whichRegion, filter)
    return TriggerRegisterEnterRegion(
        self.handle,
        whichRegion,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Trigger.prototype.registerFilterUnitEvent(self, whichUnit, whichEvent, filter)
    return TriggerRegisterFilterUnitEvent(
        self.handle,
        whichUnit,
        whichEvent,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Trigger.prototype.registerGameEvent(self, whichGameEvent)
    return TriggerRegisterGameEvent(self.handle, whichGameEvent)
end
function Trigger.prototype.registerGameStateEvent(self, whichState, opcode, limitval)
    return TriggerRegisterGameStateEvent(self.handle, whichState, opcode, limitval)
end
function Trigger.prototype.registerLeaveRegion(self, whichRegion, filter)
    return TriggerRegisterLeaveRegion(
        self.handle,
        whichRegion,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Trigger.prototype.registerPlayerAllianceChange(self, whichPlayer, whichAlliance)
    return TriggerRegisterPlayerAllianceChange(self.handle, whichPlayer.handle, whichAlliance)
end
function Trigger.prototype.registerPlayerChatEvent(self, whichPlayer, chatMessageToDetect, exactMatchOnly)
    return TriggerRegisterPlayerChatEvent(self.handle, whichPlayer.handle, chatMessageToDetect, exactMatchOnly)
end
function Trigger.prototype.registerPlayerEvent(self, whichPlayer, whichPlayerEvent)
    return TriggerRegisterPlayerEvent(self.handle, whichPlayer.handle, whichPlayerEvent)
end
function Trigger.prototype.registerPlayerKeyEvent(self, whichPlayer, whichKey, metaKey, fireOnKeyDown)
    return BlzTriggerRegisterPlayerKeyEvent(self.handle, whichPlayer.handle, whichKey, metaKey, fireOnKeyDown)
end
function Trigger.prototype.registerPlayerMouseEvent(self, whichPlayer, whichMouseEvent)
    return TriggerRegisterPlayerMouseEventBJ(self.handle, whichPlayer.handle, whichMouseEvent)
end
function Trigger.prototype.registerPlayerStateEvent(self, whichPlayer, whichState, opcode, limitval)
    return TriggerRegisterPlayerStateEvent(self.handle, whichPlayer.handle, whichState, opcode, limitval)
end
function Trigger.prototype.registerPlayerSyncEvent(self, whichPlayer, prefix, fromServer)
    return BlzTriggerRegisterPlayerSyncEvent(self.handle, whichPlayer.handle, prefix, fromServer)
end
function Trigger.prototype.registerPlayerUnitEvent(self, whichPlayer, whichPlayerUnitEvent, filter)
    return TriggerRegisterPlayerUnitEvent(
        self.handle,
        whichPlayer.handle,
        whichPlayerUnitEvent,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Trigger.prototype.registerTimerEvent(self, timeout, periodic)
    return TriggerRegisterTimerEvent(self.handle, timeout, periodic)
end
function Trigger.prototype.registerTimerExpireEvent(self, t)
    return TriggerRegisterTimerExpireEvent(self.handle, t)
end
function Trigger.prototype.registerTrackableHitEvent(self, whichTrackable)
    return TriggerRegisterTrackableHitEvent(self.handle, whichTrackable)
end
function Trigger.prototype.registerTrackableTrackEvent(self, whichTrackable)
    return TriggerRegisterTrackableTrackEvent(self.handle, whichTrackable)
end
function Trigger.prototype.registerUnitEvent(self, whichUnit, whichEvent)
    return TriggerRegisterUnitEvent(self.handle, whichUnit.handle, whichEvent)
end
function Trigger.prototype.registerUnitInRage(self, whichUnit, range, filter)
    return TriggerRegisterUnitInRange(
        self.handle,
        whichUnit,
        range,
        (((type(filter) == "function") and (function() return Filter(filter) end)) or (function() return filter end))()
    )
end
function Trigger.prototype.registerUnitStateEvent(self, whichUnit, whichState, opcode, limitval)
    return TriggerRegisterUnitStateEvent(self.handle, whichUnit.handle, whichState, opcode, limitval)
end
function Trigger.prototype.registerUpgradeCommandEvent(self, whichUpgrade)
    return TriggerRegisterUpgradeCommandEvent(self.handle, whichUpgrade)
end
function Trigger.prototype.registerVariableEvent(self, varName, opcode, limitval)
    return TriggerRegisterVariableEvent(self.handle, varName, opcode, limitval)
end
function Trigger.prototype.removeAction(self, whichAction)
    return TriggerRemoveAction(self.handle, whichAction)
end
function Trigger.prototype.removeActions(self)
    return TriggerClearActions(self.handle)
end
function Trigger.prototype.removeCondition(self, whichCondition)
    return TriggerRemoveCondition(self.handle, whichCondition)
end
function Trigger.prototype.removeConditions(self)
    return TriggerClearConditions(self.handle)
end
function Trigger.prototype.reset(self)
    ResetTrigger(self.handle)
end
function Trigger.prototype.triggerRegisterFrameEvent(self, frame, eventId)
    return BlzTriggerRegisterFrameEvent(self.handle, frame.handle, eventId)
end
function Trigger.fromEvent(self)
    return self:fromHandle(
        GetTriggeringTrigger()
    )
end
function Trigger.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.ubersplat"] = function() require("lualib_bundle");
local ____exports = {}
local ____handle = require("node_modules.w3ts.handles.handle")
local Handle = ____handle.Handle
____exports.Ubersplat = __TS__Class()
local Ubersplat = ____exports.Ubersplat
Ubersplat.name = "Ubersplat"
__TS__ClassExtends(Ubersplat, Handle)
function Ubersplat.prototype.____constructor(self, x, y, name, red, green, blue, alpha, forcePaused, noBirthTime)
    if Handle:initFromHandle() then
        Handle.prototype.____constructor(self)
    else
        Handle.prototype.____constructor(
            self,
            CreateUbersplat(x, y, name, red, green, blue, alpha, forcePaused, noBirthTime)
        )
    end
end
function Ubersplat.prototype.destroy(self)
    DestroyUbersplat(self.handle)
end
function Ubersplat.prototype.finish(self)
    FinishUbersplat(self.handle)
end
function Ubersplat.prototype.render(self, flag, always)
    if always == nil then
        always = false
    end
    if always then
        SetUbersplatRenderAlways(self.handle, flag)
    else
        SetUbersplatRender(self.handle, flag)
    end
end
function Ubersplat.prototype.reset(self)
    ResetUbersplat(self.handle)
end
function Ubersplat.prototype.show(self, flag)
    ShowUbersplat(self.handle, flag)
end
function Ubersplat.fromHandle(self, handle)
    return self:getObject(handle)
end
return ____exports
end,
["node_modules.w3ts.handles.index"] = function() local ____exports = {}
do
    local ____export = require("node_modules.w3ts.handles.camera")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.destructable")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.dialog")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.effect")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.fogmodifier")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.force")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.frame")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.gamecache")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.group")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.handle")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.image")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.item")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.leaderboard")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.multiboard")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.player")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.point")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.quest")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.rect")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.region")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.sound")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.texttag")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.timer")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.timerdialog")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.trigger")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.ubersplat")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.unit")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.handles.widget")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
return ____exports
end,
["node_modules.w3ts.hooks.index"] = function() require("lualib_bundle");
local ____exports = {}
local oldMain = main
local oldConfig = config
local hooksMainBefore = {}
local hooksMainAfter = {}
local hooksConfigBefore = {}
local hooksConfigAfter = {}
____exports.executeHooksMainBefore = function() return __TS__ArrayForEach(
    hooksMainBefore,
    function(____, func) return func() end
) end
____exports.executeHooksMainAfter = function() return __TS__ArrayForEach(
    hooksMainAfter,
    function(____, func) return func() end
) end
function ____exports.hookedMain()
    ____exports.executeHooksMainBefore()
    oldMain()
    ____exports.executeHooksMainAfter()
end
____exports.executeHooksConfigBefore = function() return __TS__ArrayForEach(
    hooksConfigBefore,
    function(____, func) return func() end
) end
____exports.executeHooksConfigAfter = function() return __TS__ArrayForEach(
    hooksConfigAfter,
    function(____, func) return func() end
) end
function ____exports.hookedConfig()
    ____exports.executeHooksConfigBefore()
    oldConfig()
    ____exports.executeHooksConfigAfter()
end
main = ____exports.hookedMain
config = ____exports.hookedConfig
____exports.W3TS_HOOK = {}
____exports.W3TS_HOOK.MAIN_BEFORE = "main::before"
____exports.W3TS_HOOK.MAIN_AFTER = "main::after"
____exports.W3TS_HOOK.CONFIG_BEFORE = "config::before"
____exports.W3TS_HOOK.CONFIG_AFTER = "config::after"
local entryPoints = {[____exports.W3TS_HOOK.MAIN_BEFORE] = hooksMainBefore, [____exports.W3TS_HOOK.MAIN_AFTER] = hooksMainAfter, [____exports.W3TS_HOOK.CONFIG_BEFORE] = hooksConfigBefore, [____exports.W3TS_HOOK.CONFIG_AFTER] = hooksConfigAfter}
function ____exports.addScriptHook(entryPoint, hook)
    if not (entryPoints[entryPoint] ~= nil) then
        return false
    end
    __TS__ArrayPush(entryPoints[entryPoint], hook)
    return true
end
return ____exports
end,
["node_modules.w3ts.system.base64"] = function() require("lualib_bundle");
local ____exports = {}
local chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
function ____exports.base64Encode(input)
    local output = ""
    do
        local block = 0
        local charCode = 0
        local idx = 0
        local map = chars
        while (#__TS__StringCharAt(
            input,
            math.floor(idx) | 0
        ) > 0) or (function()
            map = "="
            return idx % 1
        end)() do
            charCode = string.byte(
                input,
                math.floor(
                    (function()
                        idx = idx + (3 / 4)
                        return idx
                    end)()
                ) + 1
            ) or 0
            if (math.floor(idx) > #input) and (charCode == 0) then
                if (#output % 4) == 1 then
                    return tostring(output) .. "="
                end
                return tostring(output) .. "=="
            end
            if charCode > 255 then
                print("'base64Encode' failed: The string to be encoded contains characters outside of the Latin1 range.")
                return output
            end
            block = (block << 8) | charCode
            output = tostring(output) .. tostring(
                __TS__StringCharAt(
                    map,
                    math.floor(63 & (block >> (8 - ((idx % 1) * 8))))
                )
            )
        end
    end
    return output
end
function ____exports.base64Decode(input)
    local i = #input
    do
        while (i > 0) and (__TS__StringAccess(input, i) ~= "=") do
            i = i - 1
        end
    end
    local str = __TS__StringSubstr(input, 0, i - 1)
    local output = ""
    if (#str % 4) == 1 then
        print("'base64Decode' failed: The string to be decoded is not correctly encoded.")
        return output
    end
    local bs = 0
    do
        local bc = 0
        local buffer
        local idx = 0
        while (function()
            buffer = __TS__StringCharAt(str, idx)
            return buffer
        end)() do
            if #tostring(buffer) == 0 then
                break
            end
            buffer = (string.find(chars, buffer, nil, true) or 0) - 1
            idx = idx + 1;
            (((~buffer and ((function()
                bs = ((((bc % 4) ~= 0) and (function() return (bs * 64) + buffer end)) or (function() return buffer end))()
                return (function()
                    local ____tmp = bc
                    bc = ____tmp + 1
                    return ____tmp
                end)() % 4
            end)() ~= 0)) and (function() return (function()
                output = tostring(output) .. tostring(
                    string.char(255 & (bs >> ((-2 * bc) & 6)))
                )
                return output
            end)() end)) or (function() return 0 end))()
        end
    end
    return output
end
return ____exports
end,
["node_modules.w3ts.system.binaryreader"] = function() require("lualib_bundle");
local ____exports = {}
____exports.BinaryReader = __TS__Class()
local BinaryReader = ____exports.BinaryReader
BinaryReader.name = "BinaryReader"
function BinaryReader.prototype.____constructor(self, binaryString)
    self.pos = 1
    self.data = binaryString
end
function BinaryReader.prototype.read(self, fmt, size)
    local unpacked = {
        string.unpack(fmt, self.data, self.pos)
    }
    self.pos = self.pos + size
    if #unpacked <= 0 then
        return 0
    end
    return unpacked[1]
end
function BinaryReader.prototype.readDouble(self)
    return self:read(">d", 4)
end
function BinaryReader.prototype.readFloat(self)
    return self:read(">f", 4)
end
function BinaryReader.prototype.readInt16(self)
    return self:read(">h", 2)
end
function BinaryReader.prototype.readInt32(self)
    return self:read(">i4", 4)
end
function BinaryReader.prototype.readInt8(self)
    return self:read(">b", 1)
end
function BinaryReader.prototype.readString(self)
    local value = self:read(">z", 0)
    self.pos = self.pos + (#value + 1)
    return value
end
function BinaryReader.prototype.readUInt16(self)
    return self:read(">H", 2)
end
function BinaryReader.prototype.readUInt32(self)
    return self:read(">I4", 4)
end
function BinaryReader.prototype.readUInt8(self)
    return self:read(">B", 1)
end
return ____exports
end,
["node_modules.w3ts.system.binarywriter"] = function() require("lualib_bundle");
local ____exports = {}
____exports.BinaryWriter = __TS__Class()
local BinaryWriter = ____exports.BinaryWriter
BinaryWriter.name = "BinaryWriter"
function BinaryWriter.prototype.____constructor(self)
    self.values = {}
    self.fmj = ">"
end
function BinaryWriter.prototype.__tostring(self)
    return string.pack(
        self.fmj,
        table.unpack(self.values)
    )
end
function BinaryWriter.prototype.writeDouble(self, value)
    self.fmj = tostring(self.fmj) .. "d"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeFloat(self, value)
    self.fmj = tostring(self.fmj) .. "f"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeInt16(self, value)
    self.fmj = tostring(self.fmj) .. "h"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeInt32(self, value)
    self.fmj = tostring(self.fmj) .. "i4"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeInt8(self, value)
    self.fmj = tostring(self.fmj) .. "b"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeString(self, value)
    self.fmj = tostring(self.fmj) .. "z"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeUInt16(self, value)
    self.fmj = tostring(self.fmj) .. "H"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeUInt32(self, value)
    self.fmj = tostring(self.fmj) .. "I4"
    __TS__ArrayPush(self.values, value)
end
function BinaryWriter.prototype.writeUInt8(self, value)
    self.fmj = tostring(self.fmj) .. "B"
    __TS__ArrayPush(self.values, value)
end
return ____exports
end,
["node_modules.w3ts.system.file"] = function() require("lualib_bundle");
local ____exports = {}
____exports.File = __TS__Class()
local File = ____exports.File
File.name = "File"
function File.prototype.____constructor(self)
end
function File.escape(self, contents)
    contents = ({
        string.gsub(contents, ____exports.File.escapeCharacter, ____exports.File.escapedSelf)
    })[1]
    contents = ({
        string.gsub(contents, "\"", ____exports.File.escapedQuote)
    })[1]
    return contents
end
function File.unescape(self, contents)
    contents = ({
        string.gsub(contents, ____exports.File.escapedQuote, "\"")
    })[1]
    contents = ({
        string.gsub(contents, ____exports.File.escapedSelf, ____exports.File.escapeCharacter)
    })[1]
    return contents
end
function File.read(self, filename)
    local originalIcon = BlzGetAbilityIcon(self.dummyAbility)
    Preloader(filename)
    local preloadText = BlzGetAbilityIcon(self.dummyAbility)
    BlzSetAbilityIcon(self.dummyAbility, originalIcon)
    if preloadText ~= originalIcon then
        return ____exports.File:unescape(preloadText)
    end
end
function File.writeRaw(self, filename, contents, allowReading)
    if allowReading == nil then
        allowReading = false
    end
    PreloadGenClear()
    PreloadGenStart()
    if allowReading then
        Preload("\")\n//! beginusercode\nlocal o=''\nPreload=function(s)o=o..s end\nPreloadEnd=function()end\n//!endusercode\n//")
        contents = ____exports.File:escape(contents)
    end
    do
        local i = 0
        while i < (#contents / ____exports.File.preloadLimit) do
            Preload(
                tostring(
                    __TS__StringSubstr(contents, i * ____exports.File.preloadLimit, ____exports.File.preloadLimit)
                )
            )
            i = i + 1
        end
    end
    if allowReading then
        Preload(
            ("\")\n//! beginusercode\nBlzSetAbilityIcon(" .. tostring(self.dummyAbility)) .. ",o)\n//!endusercode\n//"
        )
    end
    PreloadGenEnd(filename)
    return self
end
function File.write(self, filename, contents)
    return self:writeRaw(filename, contents, true)
end
File.dummyAbility = FourCC("Amls")
File.preloadLimit = 259
File.escapeCharacter = string.char(27)
File.escapedSelf = tostring(____exports.File.escapeCharacter) .. tostring(____exports.File.escapeCharacter)
File.escapedQuote = tostring(____exports.File.escapeCharacter) .. "q"
return ____exports
end,
["node_modules.w3ts.system.gametime"] = function() require("lualib_bundle");
local ____exports = {}
local ____timer = require("node_modules.w3ts.handles.timer")
local Timer = ____timer.Timer
local elapsedTime = 0
local gameTimer = __TS__New(Timer):start(
    30,
    true,
    function()
        elapsedTime = elapsedTime + 30
    end
)
function ____exports.getElapsedTime(self)
    return elapsedTime + gameTimer.elapsed
end
return ____exports
end,
["node_modules.w3ts.system.sync"] = function() require("lualib_bundle");
local ____exports = {}
local ____player = require("node_modules.w3ts.handles.player")
local MapPlayer = ____player.MapPlayer
local ____timer = require("node_modules.w3ts.handles.timer")
local Timer = ____timer.Timer
local ____trigger = require("node_modules.w3ts.handles.trigger")
local Trigger = ____trigger.Trigger
local ____base64 = require("node_modules.w3ts.system.base64")
local base64Decode = ____base64.base64Decode
local base64Encode = ____base64.base64Encode
local ____binaryreader = require("node_modules.w3ts.system.binaryreader")
local BinaryReader = ____binaryreader.BinaryReader
local ____binarywriter = require("node_modules.w3ts.system.binarywriter")
local BinaryWriter = ____binarywriter.BinaryWriter
local ____gametime = require("node_modules.w3ts.system.gametime")
local getElapsedTime = ____gametime.getElapsedTime
local SYNC_PREFIX = "T"
local SYNC_PREFIX_CHUNK = "S"
local SYNC_MAX_CHUNK_SIZE = 244
local SyncIncomingPacket = __TS__Class()
SyncIncomingPacket.name = "SyncIncomingPacket"
function SyncIncomingPacket.prototype.____constructor(self, prefix, data)
    local isChunk = prefix == SYNC_PREFIX_CHUNK
    local header = base64Decode(
        ((isChunk and (function() return __TS__StringSubstr(data, 0, 10) end)) or (function() return __TS__StringSubstr(data, 0, 5) end))()
    )
    local reader = __TS__New(BinaryReader, header)
    local id = reader:readUInt16()
    self.req = ____exports.SyncRequest:fromIndex(id)
    self.chunks = ((isChunk and (function() return reader:readUInt16() end)) or (function() return 0 end))()
    self.chunk = ((isChunk and (function() return reader:readUInt16() end)) or (function() return 0 end))()
    self.data = ((isChunk and (function() return __TS__StringSubstr(data, 10) end)) or (function() return __TS__StringSubstr(data, 5) end))()
end
local SyncOutgoingPacket = __TS__Class()
SyncOutgoingPacket.name = "SyncOutgoingPacket"
function SyncOutgoingPacket.prototype.____constructor(self, req, data, chunk, totalChunks)
    if chunk == nil then
        chunk = -1
    end
    if totalChunks == nil then
        totalChunks = 0
    end
    self.req = req
    self.data = data
    self.chunk = chunk
    self.chunks = totalChunks
end
function SyncOutgoingPacket.prototype.getHeader(self)
    local writer = __TS__New(BinaryWriter)
    writer:writeUInt16(self.req.id)
    if self.chunk ~= -1 then
        writer:writeUInt16(self.chunks)
        writer:writeUInt16(self.chunk)
    end
    return base64Encode(
        tostring(writer)
    )
end
function SyncOutgoingPacket.prototype.__tostring(self)
    local header = self:getHeader()
    local writer = __TS__New(BinaryWriter)
    writer:writeString(self.data)
    return tostring(header) .. tostring(
        tostring(writer)
    )
end
____exports.SyncRequest = __TS__Class()
local SyncRequest = ____exports.SyncRequest
SyncRequest.name = "SyncRequest"
function SyncRequest.prototype.____constructor(self, from, data, options)
    self._startTime = 0
    self.chunks = {}
    self.currentChunk = 0
    self.destroyed = false
    self.status = 0
    self.options = (((not options) and (function() return ____exports.SyncRequest.defaultOptions end)) or (function() return options end))()
    self.from = from
    self.id = self:allocate()
    ____exports.SyncRequest.indicies[self.id + 1] = -1
    ____exports.SyncRequest.cache[self.id + 1] = self
    ____exports.SyncRequest:init()
    if type(data) == "string" then
        self:start(data)
    end
end
__TS__SetDescriptor(
    SyncRequest.prototype,
    "startTime",
    {
        get = function(self)
            return self._startTime
        end
    },
    true
)
function SyncRequest.prototype.catch(self, callback)
    self.onError = callback
    return self
end
function SyncRequest.prototype.destroy(self)
    ____exports.SyncRequest.indicies[self.id + 1] = ____exports.SyncRequest.index
    ____exports.SyncRequest.index = self.id
    self.destroyed = true
end
function SyncRequest.prototype.start(self, data)
    if (self.status ~= 0) or self.destroyed then
        return false
    end
    self.currentChunk = 0
    if #data <= SYNC_MAX_CHUNK_SIZE then
        self:send(
            __TS__New(SyncOutgoingPacket, self, data)
        )
    else
        local chunks = math.floor(#data / SYNC_MAX_CHUNK_SIZE)
        do
            local i = 0
            while i <= chunks do
                self:send(
                    __TS__New(
                        SyncOutgoingPacket,
                        self,
                        __TS__StringSubstr(data, i * SYNC_MAX_CHUNK_SIZE, SYNC_MAX_CHUNK_SIZE),
                        i,
                        chunks
                    )
                )
                i = i + 1
            end
        end
    end
    self._startTime = getElapsedTime(nil)
    self.status = 1
    if self.options.timeout > 0 then
        __TS__New(Timer):start(
            self.options.timeout,
            false,
            function()
                Timer:fromExpired():destroy()
                if self.onError and (self.status == 1) then
                    self.onError({data = "Timeout", status = 3, time = self.startTime}, self)
                end
            end
        )
    end
    return true
end
SyncRequest.prototype["then"] = function(self, callback)
    self.onResponse = callback
    return self
end
function SyncRequest.prototype.allocate(self)
    if ____exports.SyncRequest.index ~= 0 then
        local id = ____exports.SyncRequest.index
        ____exports.SyncRequest.index = ____exports.SyncRequest.indicies[id + 1]
        return id
    else
        ____exports.SyncRequest.counter = ____exports.SyncRequest.counter + 1
        return ____exports.SyncRequest.counter
    end
end
function SyncRequest.prototype.send(self, packet)
    local prefix = ((packet.chunk == -1) and SYNC_PREFIX) or SYNC_PREFIX_CHUNK
    if (self.from == MapPlayer:fromLocal()) and (not BlzSendSyncData(
        prefix,
        tostring(packet)
    )) then
        print("SyncData: Network Error")
    end
end
function SyncRequest.fromIndex(self, index)
    return self.cache[index + 1]
end
function SyncRequest.init(self)
    if self.initialized then
        return
    end
    do
        local i = 0
        while i < bj_MAX_PLAYER_SLOTS do
            local p = MapPlayer:fromIndex(i)
            if (p.controller == MAP_CONTROL_USER) and (p.slotState == PLAYER_SLOT_STATE_PLAYING) then
                self.eventTrigger:registerPlayerSyncEvent(p, SYNC_PREFIX, false)
                self.eventTrigger:registerPlayerSyncEvent(p, SYNC_PREFIX_CHUNK, false)
            end
            i = i + 1
        end
    end
    self.eventTrigger:addAction(
        function()
            self:onSync()
        end
    )
    self.initialized = true
end
function SyncRequest.onSync(self)
    local packet = __TS__New(
        SyncIncomingPacket,
        BlzGetTriggerSyncPrefix(),
        BlzGetTriggerSyncData()
    )
    if not packet.req then
        return
    end
    local ____obj, ____index = packet.req, "currentChunk"
    ____obj[____index] = ____obj[____index] + 1
    packet.req.chunks[packet.chunk + 1] = packet.data
    if packet.chunk >= packet.chunks then
        if packet.req.onResponse then
            local data = table.concat(packet.req.chunks, "" or ",")
            local status = 2
            packet.req.status = 2
            packet.req.onResponse(
                {
                    data = data,
                    status = status,
                    time = getElapsedTime(nil)
                },
                packet.req
            )
        end
    end
end
SyncRequest.cache = {}
SyncRequest.counter = 0
SyncRequest.defaultOptions = {timeout = 0}
SyncRequest.eventTrigger = __TS__New(Trigger)
SyncRequest.index = 0
SyncRequest.indicies = {}
SyncRequest.initialized = false
return ____exports
end,
["node_modules.w3ts.system.host"] = function() require("lualib_bundle");
local ____exports = {}
local ____index = require("node_modules.w3ts.handles.index")
local MapPlayer = ____index.MapPlayer
local ____timer = require("node_modules.w3ts.handles.timer")
local Timer = ____timer.Timer
local ____index = require("node_modules.w3ts.hooks.index")
local addScriptHook = ____index.addScriptHook
local W3TS_HOOK = ____index.W3TS_HOOK
local ____base64 = require("node_modules.w3ts.system.base64")
local base64Decode = ____base64.base64Decode
local base64Encode = ____base64.base64Encode
local ____binaryreader = require("node_modules.w3ts.system.binaryreader")
local BinaryReader = ____binaryreader.BinaryReader
local ____binarywriter = require("node_modules.w3ts.system.binarywriter")
local BinaryWriter = ____binarywriter.BinaryWriter
local ____sync = require("node_modules.w3ts.system.sync")
local SyncRequest = ____sync.SyncRequest
local lobbyTimes, checkTimer, hostCallbacks, localJoinTime, localStartTime, host, isChecking, findHost
function findHost()
    isChecking = true
    if localStartTime == 0 then
        localStartTime = os.clock()
    end
    local writer = __TS__New(BinaryWriter)
    writer:writeFloat(localStartTime - localJoinTime);
    (function()
        local ____self = __TS__New(
            SyncRequest,
            MapPlayer:fromLocal(),
            base64Encode(
                tostring(writer)
            )
        )
        return ____self["then"](
            ____self,
            function(res, req)
                local data = base64Decode(res.data)
                local reader = __TS__New(BinaryReader, data)
                local syncedTime = reader:readFloat()
                local from = MapPlayer:fromEvent()
                lobbyTimes[from.id + 1] = syncedTime
                local hostTime = 0
                local hostId = 0
                do
                    local i = 0
                    while i < bj_MAX_PLAYERS do
                        do
                            local p = MapPlayer:fromIndex(i)
                            if (p.slotState ~= PLAYER_SLOT_STATE_PLAYING) or (p.controller ~= MAP_CONTROL_USER) then
                                goto __continue14
                            end
                            if not lobbyTimes[p.id + 1] then
                                return
                            end
                            if lobbyTimes[p.id + 1] > hostTime then
                                hostTime = lobbyTimes[p.id + 1]
                                hostId = p.id
                            end
                        end
                        ::__continue14::
                        i = i + 1
                    end
                end
                host = MapPlayer:fromIndex(hostId)
                checkTimer:destroy()
                for ____, cb in ipairs(hostCallbacks) do
                    cb()
                end
            end
        )
    end)():catch(
        function(res)
            print(
                "findHost Error: " .. tostring(res.status)
            )
            isChecking = false
        end
    )
end
lobbyTimes = {}
checkTimer = __TS__New(Timer)
hostCallbacks = {}
localJoinTime = 0
localStartTime = 0
isChecking = false
function ____exports.getHost()
    if host then
        return host
    elseif not isChecking then
        checkTimer:start(0, false, findHost)
    end
    return
end
function ____exports.onHostDetect(callback)
    if host then
        callback()
    else
        __TS__ArrayPush(hostCallbacks, callback)
    end
end
local function onConfig()
    if localJoinTime == 0 then
        localJoinTime = os.clock()
    end
end
local function onMain()
    checkTimer:start(0, false, findHost)
end
addScriptHook(W3TS_HOOK.MAIN_AFTER, onMain)
addScriptHook(W3TS_HOOK.CONFIG_BEFORE, onConfig)
return ____exports
end,
["node_modules.w3ts.system.index"] = function() local ____exports = {}
do
    local ____export = require("node_modules.w3ts.system.base64")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.system.binaryreader")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.system.binarywriter")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.system.file")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.system.gametime")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.system.host")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.system.sync")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
return ____exports
end,
["node_modules.w3ts.utils.color"] = function() require("lualib_bundle");
local ____exports = {}
local orderedPlayerColors, toHex
function toHex(self, value)
    local hex = __TS__NumberToString(value, 16)
    if #hex < 2 then
        hex = "0" .. tostring(hex)
    end
    return hex
end
____exports.Color = __TS__Class()
local Color = ____exports.Color
Color.name = "Color"
function Color.prototype.____constructor(self, red, green, blue, alpha)
    self.red = red
    self.green = green
    self.blue = blue
    if alpha then
        self.alpha = alpha
    else
        self.alpha = 255
    end
end
__TS__SetDescriptor(
    Color.prototype,
    "code",
    {
        get = function(self)
            return (("|c" .. tostring(
                toHex(nil, self.alpha)
            )) .. tostring(
                toHex(nil, self.red)
            )) .. (tostring(
                toHex(nil, self.green)
            ) .. tostring(
                toHex(nil, self.blue)
            ))
        end
    },
    true
)
__TS__SetDescriptor(
    Color.prototype,
    "name",
    {
        get = function(self)
            local index = self:playerColorIndex()
            if index < #____exports.playerColors then
                return ____exports.playerColorNames[index + 1]
            end
            return "unknown"
        end
    },
    true
)
__TS__SetDescriptor(
    Color.prototype,
    "playerColor",
    {
        get = function(self)
            local index = self:playerColorIndex()
            if index < #____exports.playerColors then
                return orderedPlayerColors[index + 1]
            end
            return PLAYER_COLOR_RED
        end
    },
    true
)
function Color.prototype.equals(self, other)
    return (((self.red == other.red) and (self.green == other.green)) and (self.blue == other.blue)) and (self.alpha == other.alpha)
end
function Color.prototype.playerColorIndex(self)
    local i = 0
    do
        while i < #____exports.playerColors do
            if ____exports.playerColors[i + 1]:equals(self) then
                break
            end
            i = i + 1
        end
    end
    return i
end
function Color.prototype.lerp(self, other, factor)
    local r = MathRound((self.red * (1 - factor)) + (other.red * factor))
    local g = MathRound((self.green * (1 - factor)) + (other.green * factor))
    local b = MathRound((self.blue * (1 - factor)) + (other.blue * factor))
    local a = MathRound((self.alpha * (1 - factor)) + (other.alpha * factor))
    return __TS__New(
        ____exports.Color,
        math.max(
            0,
            math.min(255, r)
        ),
        math.max(
            0,
            math.min(255, g)
        ),
        math.max(
            0,
            math.min(255, b)
        ),
        math.max(
            0,
            math.min(255, a)
        )
    )
end
____exports.color = function(____, red, green, blue, alpha) return __TS__New(____exports.Color, red, green, blue, alpha) end
____exports.playerColors = {
    ____exports.color(nil, 255, 3, 3),
    ____exports.color(nil, 0, 66, 255),
    ____exports.color(nil, 28, 230, 185),
    ____exports.color(nil, 84, 0, 129),
    ____exports.color(nil, 255, 252, 0),
    ____exports.color(nil, 254, 138, 14),
    ____exports.color(nil, 32, 192, 0),
    ____exports.color(nil, 229, 91, 176),
    ____exports.color(nil, 149, 150, 151),
    ____exports.color(nil, 126, 191, 241),
    ____exports.color(nil, 16, 98, 70),
    ____exports.color(nil, 78, 42, 3),
    ____exports.color(nil, 155, 0, 0),
    ____exports.color(nil, 0, 0, 195),
    ____exports.color(nil, 0, 234, 255),
    ____exports.color(nil, 190, 0, 254),
    ____exports.color(nil, 235, 205, 135),
    ____exports.color(nil, 248, 164, 139),
    ____exports.color(nil, 191, 255, 128),
    ____exports.color(nil, 220, 185, 235),
    ____exports.color(nil, 80, 79, 85),
    ____exports.color(nil, 235, 240, 255),
    ____exports.color(nil, 0, 120, 30),
    ____exports.color(nil, 164, 111, 51)
}
____exports.playerColorNames = {"red", "blue", "teal", "purple", "yellow", "orange", "green", "pink", "gray", "light blue", "dark green", "brown", "maroon", "navy", "turquoise", "violet", "wheat", "peach", "mint", "lavender", "coal", "snow", "emerald", "peanut"}
orderedPlayerColors = {PLAYER_COLOR_RED, PLAYER_COLOR_BLUE, PLAYER_COLOR_CYAN, PLAYER_COLOR_PURPLE, PLAYER_COLOR_YELLOW, PLAYER_COLOR_ORANGE, PLAYER_COLOR_GREEN, PLAYER_COLOR_PINK, PLAYER_COLOR_LIGHT_GRAY, PLAYER_COLOR_LIGHT_BLUE, PLAYER_COLOR_AQUA, PLAYER_COLOR_BROWN, PLAYER_COLOR_MAROON, PLAYER_COLOR_NAVY, PLAYER_COLOR_TURQUOISE, PLAYER_COLOR_VIOLET, PLAYER_COLOR_WHEAT, PLAYER_COLOR_PEACH, PLAYER_COLOR_MINT, PLAYER_COLOR_LAVENDER, PLAYER_COLOR_COAL, PLAYER_COLOR_SNOW, PLAYER_COLOR_EMERALD, PLAYER_COLOR_PEANUT}
return ____exports
end,
["node_modules.w3ts.utils.index"] = function() local ____exports = {}
do
    local ____export = require("node_modules.w3ts.utils.color")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
return ____exports
end,
["node_modules.w3ts.globals.index"] = function() local ____exports = {}
local ____player = require("node_modules.w3ts.handles.player")
local MapPlayer = ____player.MapPlayer
____exports.Players = {}
do
    local i = 0
    while i < bj_MAX_PLAYER_SLOTS do
        ____exports.Players[i + 1] = MapPlayer:fromHandle(
            Player(i)
        )
        i = i + 1
    end
end
return ____exports
end,
["node_modules.w3ts.index"] = function() local ____exports = {}
local tsGlobals = require("node_modules.w3ts.globals.index")
do
    local ____export = require("node_modules.w3ts.handles.index")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.hooks.index")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.system.index")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
do
    local ____export = require("node_modules.w3ts.utils.index")
    for ____exportKey, ____exportValue in pairs(____export) do
        if ____exportKey ~= "default" then
            ____exports[____exportKey] = ____exportValue
        end
    end
end
____exports.tsGlobals = tsGlobals
return ____exports
end,
["src.player_features.draw"] = function() require("lualib_bundle");
local ____exports = {}
local ____index = require("node_modules.w3ts.index")
local MapPlayer = ____index.MapPlayer
local getElapsedTime = ____index.getElapsedTime
function ____exports.enableDraw()
    local drawTrigger = CreateTrigger()
    local players = {}
    local playerCount = 0
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            if GetPlayerSlotState(
                Player(i)
            ) == PLAYER_SLOT_STATE_PLAYING then
                playerCount = playerCount + 1
                TriggerRegisterPlayerChatEvent(
                    drawTrigger,
                    Player(i),
                    "-draw",
                    true
                )
            end
            i = i + 1
        end
    end
    local requiredPlayers = playerCount
    if playerCount == 4 then
        requiredPlayers = 3
    elseif playerCount == 8 then
        requiredPlayers = 6
    end
    TriggerAddAction(
        drawTrigger,
        function()
            local triggerPlayer = MapPlayer:fromEvent()
            if getElapsedTime(nil) > 120 then
                DisplayTextToPlayer(triggerPlayer.handle, 0, 0, "|cff00ff00[W3C]:|r The|cffffff00 -draw|r command is disabled after two minutes of gameplay.")
                return
            end
            if __TS__ArrayIndexOf(players, triggerPlayer.name) == -1 then
                __TS__ArrayPush(players, triggerPlayer.name)
                local remainingPlayers = requiredPlayers - #players
                if #players == 1 then
                    print(
                        ((("|cff00ff00[W3C]:|r|cffFF4500 " .. tostring(triggerPlayer.name)) .. "|r is proposing to cancel this game. \nType|cffffff00 -draw|r to cancel the game. ") .. tostring(remainingPlayers)) .. " player(s) remaining."
                    )
                elseif #players < requiredPlayers then
                    print(
                        ((("|cff00ff00[W3C]:|r|cffFF4500 " .. tostring(triggerPlayer.name)) .. "|r votes to cancel this game. ") .. tostring(remainingPlayers)) .. " player(s) remaining."
                    )
                end
            end
            if #players == requiredPlayers then
                do
                    local i = 0
                    while i < bj_MAX_PLAYERS do
                        RemovePlayerPreserveUnitsBJ(
                            Player(i),
                            PLAYER_GAME_RESULT_NEUTRAL,
                            false
                        )
                        i = i + 1
                    end
                end
            end
        end
    )
end
return ____exports
end,
["src.utils"] = function() require("lualib_bundle");
local ____exports = {}
local ____index = require("node_modules.w3ts.index")
local MapPlayer = ____index.MapPlayer
local ____index = require("node_modules.w3ts.globals.index")
local Players = ____index.Players
function ____exports.getPlayerRGBCode(player)
    local color = player.color
    if GetAllyColorFilterState() == 2 then
        if MapPlayer:fromLocal():isObserver() == false then
            if player == Players[PLAYER_NEUTRAL_AGGRESSIVE + 1] then
                return {50, 50, 50}
            elseif player == MapPlayer:fromLocal() then
                return {0, 25.88, 100}
            elseif player:isPlayerAlly(
                MapPlayer:fromLocal()
            ) then
                return {10.59, 90.59, 72.94}
            else
                return {100, 1.18, 1.18}
            end
        else
            do
                local i = 0
                while i < bj_MAX_PLAYERS do
                    if player:isPlayerAlly(
                        MapPlayer:fromIndex(i)
                    ) then
                        color = MapPlayer:fromIndex(i).color
                        break
                    end
                    i = i + 1
                end
            end
        end
    end
    if color == PLAYER_COLOR_RED then
        return {100, 1.18, 1.18}
    elseif color == PLAYER_COLOR_BLUE then
        return {0, 25.88, 100}
    elseif color == PLAYER_COLOR_CYAN then
        return {10.59, 90.59, 72.94}
    elseif color == PLAYER_COLOR_PURPLE then
        return {33.33, 0, 50.59}
    elseif color == PLAYER_COLOR_YELLOW then
        return {99.61, 98.82, 0}
    elseif color == PLAYER_COLOR_ORANGE then
        return {99.61, 53.73, 5.1}
    elseif color == PLAYER_COLOR_GREEN then
        return {12.94, 74.9, 0}
    elseif color == PLAYER_COLOR_PINK then
        return {89.41, 36.08, 68.63}
    elseif color == PLAYER_COLOR_LIGHT_GRAY then
        return {57.65, 58.43, 58.82}
    elseif color == PLAYER_COLOR_LIGHT_BLUE then
        return {49.41, 74.9, 94.51}
    elseif color == PLAYER_COLOR_AQUA then
        return {6.27, 38.43, 27.84}
    elseif color == PLAYER_COLOR_BROWN then
        return {30.98, 16.86, 1.96}
    elseif color == PLAYER_COLOR_MAROON then
        return {61.18, 0, 0}
    elseif color == PLAYER_COLOR_NAVY then
        return {0, 0, 76.47}
    elseif color == PLAYER_COLOR_TURQUOISE then
        return {0, 92.16, 100}
    elseif color == PLAYER_COLOR_VIOLET then
        return {74.12, 0, 100}
    elseif color == PLAYER_COLOR_WHEAT then
        return {92.55, 80.78, 52.94}
    elseif color == PLAYER_COLOR_PEACH then
        return {96.86, 64.71, 54.51}
    elseif color == PLAYER_COLOR_MINT then
        return {74.9, 100, 50.59}
    elseif color == PLAYER_COLOR_LAVENDER then
        return {85.88, 72.16, 92.16}
    elseif color == PLAYER_COLOR_COAL then
        return {30.98, 31.37, 33.33}
    elseif color == PLAYER_COLOR_SNOW then
        return {92.55, 94.12, 100}
    elseif color == PLAYER_COLOR_EMERALD then
        return {0, 47.06, 11.76}
    elseif color == PLAYER_COLOR_PEANUT then
        return {64.71, 43.53, 20.39}
    else
        return {50, 50, 50}
    end
end
function ____exports.getPlayerHexCode(player)
    return "cff" .. tostring(
        table.concat(
            __TS__ArrayMap(
                ____exports.getPlayerRGBCode(player),
                function(____, x)
                    local hex = __TS__NumberToString(
                        R2I((x / 100) * 255),
                        16
                    )
                    return (((#hex == 1) and (function() return "0" .. tostring(hex) end)) or (function() return hex end))()
                end
            ),
            "" or ","
        )
    )
end
function ____exports.getPlayerNameWithoutNumber(player)
    local i = (string.find(player.name, "#", nil, true) or 0) - 1
    if i == -1 then
        return player.name
    else
        return __TS__StringSubstr(player.name, 0, i)
    end
end
function ____exports.getGameMode()
    local teams = {}
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            if (GetPlayerSlotState(
                Player(i)
            ) == PLAYER_SLOT_STATE_PLAYING) and (not IsPlayerObserver(
                Player(i)
            )) then
                local team = GetPlayerTeam(
                    Player(i)
                )
                if not teams[team] then
                    teams[team] = 1
                else
                    teams[team] = teams[team] + 1
                end
            end
            i = i + 1
        end
    end
    local totalTeams = #__TS__ObjectKeys(teams)
    local playersOnTeams = teams[__TS__ObjectKeys(teams)[1]]
    local ____switch12 = totalTeams
    if ____switch12 == 2 then
        goto ____switch12_case_0
    elseif ____switch12 == 3 then
        goto ____switch12_case_1
    elseif ____switch12 == 4 then
        goto ____switch12_case_2
    end
    goto ____switch12_case_default
    ::____switch12_case_0::
    do
        do
            if playersOnTeams == 1 then
                return ____exports.MapGameMode.ONE_VS_ONE
            elseif playersOnTeams == 2 then
                return ____exports.MapGameMode.TWO_VS_TWO
            elseif playersOnTeams == 3 then
                return ____exports.MapGameMode.THREE_VS_THREE
            elseif playersOnTeams == 4 then
                return ____exports.MapGameMode.FOUR_VS_FOUR
            else
                return ____exports.MapGameMode.UNKNOWN
            end
        end
    end
    ::____switch12_case_1::
    do
    end
    ::____switch12_case_2::
    do
        return ____exports.MapGameMode.FFA
    end
    ::____switch12_case_default::
    do
        return ____exports.MapGameMode.UNKNOWN
    end
    ::____switch12_end::
end
____exports.MapGameMode = {}
____exports.MapGameMode.ONE_VS_ONE = 1
____exports.MapGameMode[____exports.MapGameMode.ONE_VS_ONE] = "ONE_VS_ONE"
____exports.MapGameMode.TWO_VS_TWO = 2
____exports.MapGameMode[____exports.MapGameMode.TWO_VS_TWO] = "TWO_VS_TWO"
____exports.MapGameMode.THREE_VS_THREE = 3
____exports.MapGameMode[____exports.MapGameMode.THREE_VS_THREE] = "THREE_VS_THREE"
____exports.MapGameMode.FOUR_VS_FOUR = 4
____exports.MapGameMode[____exports.MapGameMode.FOUR_VS_FOUR] = "FOUR_VS_FOUR"
____exports.MapGameMode.FFA = 5
____exports.MapGameMode[____exports.MapGameMode.FFA] = "FFA"
____exports.MapGameMode.UNKNOWN = 100
____exports.MapGameMode[____exports.MapGameMode.UNKNOWN] = "UNKNOWN"
function ____exports.showMessageOverUnit(textUnit, colourPlayer, message, fontSize, showToLocalPlayer)
    local localPlayer = MapPlayer:fromLocal()
    local color = ____exports.getPlayerRGBCode(colourPlayer)
    local tag = CreateTextTagUnitBJ(message, textUnit.handle, -80, fontSize, color[1], color[2], color[3], 0)
    SetTextTagPermanentBJ(tag, false)
    SetTextTagVelocityBJ(tag, 20, 90)
    SetTextTagLifespanBJ(tag, 2)
    SetTextTagFadepointBJ(tag, 1.5)
    SetTextTagVisibility(
        tag,
        showToLocalPlayer and (((textUnit:isVisible(localPlayer) and (not textUnit:isFogged(localPlayer))) and (not textUnit:isMasked(localPlayer))) or localPlayer:isObserver())
    )
end
function ____exports.getPlayerCount()
    local count = 0
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            if (GetPlayerSlotState(
                Player(i)
            ) == PLAYER_SLOT_STATE_PLAYING) and (not IsPlayerObserver(
                Player(i)
            )) then
                count = count + 1
            end
            i = i + 1
        end
    end
    return count
end
return ____exports
end,
["src.observer_features.buildingCancel"] = function() require("lualib_bundle");
local ____exports = {}
local ____utils = require("src.utils")
local showMessageOverUnit = ____utils.showMessageOverUnit
local ____index = require("node_modules.w3ts.index")
local Unit = ____index.Unit
local MapPlayer = ____index.MapPlayer
local Trigger = ____index.Trigger
local ____index = require("node_modules.w3ts.globals.index")
local Players = ____index.Players
function ____exports.enableBuildingCancelTrigger()
    local function checkEnemyIsNearby()
        local cancellingUnit = Unit:fromHandle(
            GetTriggerUnit()
        )
        local cancellingPlayer = cancellingUnit.owner
        local atLeast1EnemyNearby = false
        ForGroupBJ(
            GetUnitsInRangeOfLocAll(
                1000,
                GetUnitLoc(cancellingUnit.handle)
            ),
            function()
                if IsUnitEnemy(
                    GetEnumUnit(),
                    cancellingPlayer.handle
                ) == true then
                    atLeast1EnemyNearby = true
                end
            end
        )
        return atLeast1EnemyNearby
    end
    local t = __TS__New(Trigger)
    t:registerAnyUnitEvent(EVENT_PLAYER_UNIT_CONSTRUCT_CANCEL)
    t:addCondition(
        function() return checkEnemyIsNearby() end
    )
    t:addAction(
        function() return showMessageOverUnit(
            Unit:fromHandle(
                GetTriggerUnit()
            ),
            Players[PLAYER_NEUTRAL_AGGRESSIVE + 1],
            "cancel",
            8,
            MapPlayer:fromLocal():isObserver()
        ) end
    )
end
return ____exports
end,
["src.observer_features.itemSoldBought"] = function() require("lualib_bundle");
local ____exports = {}
local ____utils = require("src.utils")
local getPlayerRGBCode = ____utils.getPlayerRGBCode
local ____index = require("node_modules.w3ts.index")
local Trigger = ____index.Trigger
local Unit = ____index.Unit
local Item = ____index.Item
local MapPlayer = ____index.MapPlayer
function ____exports.enableItemSoldBoughtTrigger()
    local stackCounter = 0
    local function showMessage(prefix, unit)
        stackCounter = ModuloReal(stackCounter + 1, 3)
        local item = Item:fromHandle(
            GetSoldItem()
        )
        local color = getPlayerRGBCode(unit.owner)
        local tag = CreateTextTagUnitBJ(
            ((tostring(prefix) .. " \"") .. tostring(item.name)) .. "\"",
            unit.handle,
            -50 + (-50 * stackCounter),
            10,
            color[1],
            color[2],
            color[3],
            0
        )
        SetTextTagPermanentBJ(tag, false)
        SetTextTagVelocityBJ(tag, 30, 50 + (-50 * stackCounter))
        SetTextTagLifespanBJ(tag, 2.5)
        SetTextTagFadepointBJ(tag, 2)
        SetTextTagVisibility(
            tag,
            MapPlayer:fromLocal():isObserver()
        )
    end
    local sellTrigger = __TS__New(Trigger)
    sellTrigger:registerAnyUnitEvent(EVENT_PLAYER_UNIT_PAWN_ITEM)
    sellTrigger:addAction(
        function()
            showMessage(
                "Sold",
                Unit:fromHandle(
                    GetSellingUnit()
                )
            )
        end
    )
    local buyTrigger = __TS__New(Trigger)
    buyTrigger:registerAnyUnitEvent(EVENT_PLAYER_UNIT_SELL_ITEM)
    buyTrigger:addAction(
        function()
            showMessage(
                "Bought",
                Unit:fromHandle(
                    GetBuyingUnit()
                )
            )
        end
    )
end
return ____exports
end,
["src.observer_features.listofCreepKills"] = function() require("lualib_bundle");
local ____exports = {}
local ____utils = require("src.utils")
local getPlayerNameWithoutNumber = ____utils.getPlayerNameWithoutNumber
local getPlayerHexCode = ____utils.getPlayerHexCode
local ____index = require("node_modules.w3ts.globals.index")
local Players = ____index.Players
local ____index = require("node_modules.w3ts.index")
local Unit = ____index.Unit
local Trigger = ____index.Trigger
local MapPlayer = ____index.MapPlayer
local Quest = ____index.Quest
local getElapsedTime = ____index.getElapsedTime
function ____exports.enableListOfCreepKills(self)
    local q = __TS__New(Quest)
    q:setTitle("Creep Kills")
    q:setDescription("")
    q:setIcon("ReplaceableTextures\\CommandButtons\\BTNTomeBrown.blp")
    local function getFormattedElapsedTime()
        local elapsedTime = getElapsedTime(nil)
        local minutes = R2SW(
            R2I(elapsedTime / 60),
            0,
            0
        )
        local seconds = R2SW(
            R2I(
                elapsedTime - (60 * R2I(elapsedTime / 60))
            ),
            0,
            0
        )
        local m = __TS__StringSubstr(minutes, 0, #minutes - 2)
        local s = __TS__StringSubstr(seconds, 0, #seconds - 2)
        return (((tostring(((#m == 1) and "0") or "") .. tostring(m)) .. ":") .. tostring(((#s == 1) and "0") or "")) .. tostring(s)
    end
    local function checkDyingUnitIsCreep()
        return Unit:fromHandle(
            GetDyingUnit()
        ).owner == Players[PLAYER_NEUTRAL_AGGRESSIVE + 1]
    end
    local creepKillList = ""
    local function addCreepKillToListAndUpdateQuest()
        local dyingUnit = Unit:fromHandle(
            GetDyingUnit()
        )
        local killingUnit = Unit:fromHandle(
            GetKillingUnitBJ()
        )
        local killingPlayer = killingUnit.owner
        if MapPlayer:fromLocal():isObserver() then
            local message = ("|cff808080[" .. tostring(
                getFormattedElapsedTime(nil)
            )) .. "]|r "
            if killingUnit.owner == Players[PLAYER_NEUTRAL_AGGRESSIVE + 1] then
                message = tostring(message) .. ((tostring(killingUnit.name) .. " |cff808080(Creep)|r |cffff6666denied|r ") .. tostring(dyingUnit.name))
            elseif killingUnit:isUnitType(UNIT_TYPE_STRUCTURE) then
                message = tostring(message) .. (((((((((tostring(killingUnit.name) .. " |") .. tostring(
                    getPlayerHexCode(killingPlayer)
                )) .. "(") .. tostring(
                    getPlayerNameWithoutNumber(killingPlayer)
                )) .. ")|r |cffff6666denied|r ") .. tostring(dyingUnit.name)) .. " |cff808080(Level ") .. tostring(dyingUnit.level)) .. ")|r")
            else
                message = tostring(message) .. (((((((((tostring(killingUnit.name) .. " |") .. tostring(
                    getPlayerHexCode(killingPlayer)
                )) .. "(") .. tostring(
                    getPlayerNameWithoutNumber(killingPlayer)
                )) .. ")|r killed ") .. tostring(dyingUnit.name)) .. " |cff808080(Level ") .. tostring(dyingUnit.level)) .. ")|r")
            end
            creepKillList = (tostring(message) .. "\n") .. tostring(creepKillList)
            q:setDescription(creepKillList)
        elseif killingUnit.owner:isPlayerAlly(
            MapPlayer:fromLocal()
        ) then
            local message = ("|cff808080[" .. tostring(
                getFormattedElapsedTime(nil)
            )) .. "]|r "
            if killingUnit:isUnitType(UNIT_TYPE_STRUCTURE) then
                message = tostring(message) .. (((((((((tostring(killingUnit.name) .. " |") .. tostring(
                    getPlayerHexCode(killingPlayer)
                )) .. "(") .. tostring(
                    getPlayerNameWithoutNumber(killingPlayer)
                )) .. ")|r |cffff6666denied|r ") .. tostring(dyingUnit.name)) .. " |cff808080(Level ") .. tostring(dyingUnit.level)) .. ")|r")
            else
                message = tostring(message) .. (((((((((tostring(killingUnit.name) .. " |") .. tostring(
                    getPlayerHexCode(killingPlayer)
                )) .. "(") .. tostring(
                    getPlayerNameWithoutNumber(killingPlayer)
                )) .. ")|r killed ") .. tostring(dyingUnit.name)) .. " |cff808080(Level ") .. tostring(dyingUnit.level)) .. ")|r")
            end
            creepKillList = (tostring(message) .. "\n") .. tostring(creepKillList)
            q:setDescription(creepKillList)
        end
    end
    local t = __TS__New(Trigger)
    t:registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH)
    t:addCondition(
        function() return checkDyingUnitIsCreep(nil) end
    )
    t:addAction(
        function() return addCreepKillToListAndUpdateQuest(nil) end
    )
end
return ____exports
end,
["src.showCommands"] = function() local ____exports = {}
function ____exports.enableShowCommandsTrigger()
    local showCommandsTrigger = CreateTrigger()
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            TriggerRegisterPlayerChatEvent(
                showCommandsTrigger,
                Player(i),
                "-commands",
                true
            )
            DisplayTextToPlayer(
                Player(i),
                0,
                0,
                "|cff00ff00[W3C]:|r To see available W3C commands, type|cffffff00 -commands|r.\n               "
            )
            i = i + 1
        end
    end
    TriggerAddAction(
        showCommandsTrigger,
        function()
            DisplayTimedTextToPlayer(
                GetTriggerPlayer(),
                0,
                0,
                10,
                ((((("\n|cff00ff00[W3C Commands]:|r\n" .. "  |cffffff00•|r For FLO details, type|cffffff00 !flo|r (FLO games only). \n") .. "  |cffffff00•|r Type|cffffff00 -draw|r to cancel game. Expires after 2 min. Disabled in tournaments.\n") .. "  |cffffff00•|r Type|cffffff00 -zoom <VALUE>|r to set zoom level. (1650 - 3000)\n") .. "  |cffffff00•|r Type|cffffff00 -z|r or press|cffffff00 F5|r to reset zoom to preferred value.\n") .. "  |cffffff00•|r Type|cffffff00 -deny|r to show/hide|cffffff00 !|r when a player's unit is denied.\n") .. "  |cffffff00•|r Type|cffffff00 -workercount|r to show/hide goldmine worker count."
            )
        end
    )
end
return ____exports
end,
["src.player_features.unitDeny"] = function() require("lualib_bundle");
local ____exports = {}
local ____utils = require("src.utils")
local showMessageOverUnit = ____utils.showMessageOverUnit
local ____index = require("node_modules.w3ts.index")
local Unit = ____index.Unit
local MapPlayer = ____index.MapPlayer
local Trigger = ____index.Trigger
local File = ____index.File
local ____index = require("node_modules.w3ts.globals.index")
local Players = ____index.Players
function ____exports.enableUnitDenyTrigger()
    local denyToggleTrigger = __TS__New(Trigger)
    local isDenyEnabled = true
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            local fileText = File:read("w3cUnitDeny.txt")
            if fileText then
                isDenyEnabled = fileText == "true"
            end
            denyToggleTrigger:registerPlayerChatEvent(
                MapPlayer:fromHandle(
                    Player(i)
                ),
                "-deny",
                true
            )
            i = i + 1
        end
    end
    denyToggleTrigger:addAction(
        function()
            local triggerPlayer = MapPlayer:fromEvent()
            local localPlayer = MapPlayer:fromLocal()
            if triggerPlayer.name ~= localPlayer.name then
                return
            end
            isDenyEnabled = not isDenyEnabled
            DisplayTextToPlayer(
                triggerPlayer.handle,
                0,
                0,
                ("\n|cff00ff00[W3C]:|r Showing |cffffff00 !|r when a player's unit is denied is now |cffffff00 " .. tostring((isDenyEnabled and "ENABLED") or "DISABLED")) .. "|r."
            )
            File:write(
                "w3cUnitDeny.txt",
                tostring(isDenyEnabled)
            )
        end
    )
    local function checkKillerIsAllyOfDyingUnitOrKillerIsACreep()
        local dyingUnit = Unit:fromEvent()
        local killingUnit = Unit:fromHandle(
            GetKillingUnit()
        )
        return ((((dyingUnit.owner:isPlayerAlly(killingUnit.owner) or (killingUnit.owner == Players[PLAYER_NEUTRAL_AGGRESSIVE + 1])) and (dyingUnit.owner ~= Players[PLAYER_NEUTRAL_PASSIVE + 1])) and (killingUnit.typeId ~= FourCC("usap"))) and (killingUnit.typeId ~= FourCC("otot"))) and (not (dyingUnit:isUnitType(UNIT_TYPE_STRUCTURE) and (killingUnit.typeId == FourCC("uaco"))))
    end
    local denyTrigger = __TS__New(Trigger)
    denyTrigger:registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH)
    denyTrigger:addCondition(checkKillerIsAllyOfDyingUnitOrKillerIsACreep)
    denyTrigger:addAction(
        function() return showMessageOverUnit(
            Unit:fromHandle(
                GetDyingUnit()
            ),
            Unit:fromHandle(
                GetKillingUnit()
            ).owner,
            "!",
            13,
            isDenyEnabled
        ) end
    )
end
return ____exports
end,
["src.player_features.workercount"] = function() require("lualib_bundle");
local ____exports = {}
local ____index = require("node_modules.w3ts.index")
local File = ____index.File
local MapPlayer = ____index.MapPlayer
local Trigger = ____index.Trigger
local isWorkerCountEnabled, action_lossOfUnit, action_issuedOrder, unitIsWorker, getTreeIds, getGoldIds, targetIsTree, targetIsGold, unitCanGatherTarget, unitCanGatherAppropriateGoldMine, unitOrderedToGather, isUnitReturningGold, mines, workersMineMap, addWorkerToMine, updateMineText, removeWorkerFromMine, doesMineExist, targetedOrder, action_issuedTargetOrderTrigger
function action_lossOfUnit()
    local triggerUnit = GetTriggerUnit()
    if unitIsWorker(triggerUnit) then
        removeWorkerFromMine(triggerUnit)
    end
end
function action_issuedOrder()
    local triggerUnit = GetTriggerUnit()
    local orderId = GetIssuedOrderId()
    if (unitIsWorker(triggerUnit) and (not isUnitReturningGold(orderId))) and (not unitOrderedToGather(
        orderId,
        GetUnitTypeId(
            GetOrderTargetUnit()
        )
    )) then
        removeWorkerFromMine(triggerUnit)
    end
end
function unitIsWorker(whichUnit)
    local workerIds = {
        FourCC("ngir"),
        FourCC("hpea"),
        FourCC("opeo"),
        FourCC("uaco"),
        FourCC("ewsp")
    }
    if __TS__ArraySome(
        workerIds,
        function(____, x) return x == GetUnitTypeId(whichUnit) end
    ) then
        return true
    end
    return false
end
function getTreeIds()
    return {
        FourCC("ATtr"),
        FourCC("ATtc"),
        FourCC("BTtw"),
        FourCC("BTtc"),
        FourCC("CTtc"),
        FourCC("CTtr"),
        FourCC("DTsh"),
        FourCC("FTtw"),
        FourCC("GTsh"),
        FourCC("ITtc"),
        FourCC("ITtw"),
        FourCC("JTct"),
        FourCC("JTtw"),
        FourCC("KTtw"),
        FourCC("LTlt"),
        FourCC("NTtc"),
        FourCC("NTtw"),
        FourCC("OTtw"),
        FourCC("VTlt"),
        FourCC("WTst"),
        FourCC("WTtw"),
        FourCC("YTft"),
        FourCC("YTst"),
        FourCC("YTct"),
        FourCC("YTwt"),
        FourCC("ZTtc"),
        FourCC("ZTtw")
    }
end
function getGoldIds()
    return {
        FourCC("ngol"),
        FourCC("ugol"),
        FourCC("egol")
    }
end
function targetIsTree(target)
    return __TS__ArraySome(
        getTreeIds(),
        function(____, t) return t == GetDestructableTypeId(target) end
    )
end
function targetIsGold(target)
    return __TS__ArraySome(
        getGoldIds(),
        function(____, t) return t == GetUnitTypeId(target) end
    )
end
function unitCanGatherTarget(unit, target, isUnit)
    if not isUnit then
        if unitIsWorker(unit) and targetIsTree(target) then
            return true
        end
    else
        if (unitIsWorker(unit) and targetIsGold(target)) and unitCanGatherAppropriateGoldMine(
            target,
            GetUnitTypeId(unit)
        ) then
            return true
        end
    end
    return false
end
function unitCanGatherAppropriateGoldMine(mine, workerTypeId)
    local ____switch28 = workerTypeId
    if ____switch28 == FourCC("uaco") then
        goto ____switch28_case_0
    elseif ____switch28 == FourCC("ewsp") then
        goto ____switch28_case_1
    end
    goto ____switch28_case_default
    ::____switch28_case_0::
    do
        do
            if GetUnitTypeId(mine) == FourCC("ugol") then
                return true
            else
                return false
            end
        end
    end
    ::____switch28_case_1::
    do
        do
            if GetUnitTypeId(mine) == FourCC("egol") then
                return true
            else
                return false
            end
        end
    end
    ::____switch28_case_default::
    do
        do
            if GetUnitTypeId(mine) == FourCC("ngol") then
                return true
            else
                return false
            end
        end
    end
    ::____switch28_end::
end
function unitOrderedToGather(orderId, unitTypeId)
    local target = GetUnitTypeId(
        GetOrderTargetUnit()
    )
    return (__TS__ArraySome(
        {852018, 851970},
        function(____, x) return x == orderId end
    ) and (target ~= 0)) or ((orderId == 851971) and (((unitTypeId == FourCC("ugol")) or (unitTypeId == FourCC("egol"))) or (unitTypeId == FourCC("ngol"))))
end
function isUnitReturningGold(orderId)
    return orderId == 852017
end
function addWorkerToMine(worker, mine)
    do
        local i = 0
        while i < #mines do
            if (mines[i + 1].id == mine) and (workersMineMap[worker] ~= mine) then
                if workersMineMap[worker] then
                    do
                        local j = 0
                        while j < #mines do
                            local currentMine = mines[j + 1]
                            if currentMine.id == workersMineMap[worker] then
                                mines[j + 1].workers = mines[j + 1].workers - 1
                                updateMineText(mines[j + 1])
                            end
                            j = j + 1
                        end
                    end
                end
                workersMineMap[worker] = mine
                local ____obj, ____index = mines[i + 1], "workers"
                ____obj[____index] = ____obj[____index] + 1
                updateMineText(mines[i + 1])
            end
            i = i + 1
        end
    end
end
function updateMineText(mine)
    local textTag = CreateTextTag()
    if mine.textTag then
        textTag = mine.textTag
    end
    SetTextTagTextBJ(
        textTag,
        tostring(mine.workers) .. "/5",
        13
    )
    SetTextTagPos(
        textTag,
        GetUnitX(mine.id) - 30,
        GetUnitY(mine.id) - 140,
        0
    )
    if mine.workers == 5 then
        SetTextTagColorBJ(textTag, 0, 100, 0, 100)
    else
        SetTextTagColorBJ(textTag, 100, 100, 30, 100)
    end
    SetTextTagVisibility(
        textTag,
        (isWorkerCountEnabled and (mine.workers > 0)) and (IsPlayerObserver(
            GetLocalPlayer()
        ) or (not IsPlayerEnemy(
            GetTriggerPlayer(),
            GetLocalPlayer()
        )))
    )
    mine.textTag = textTag
end
function removeWorkerFromMine(worker)
    local currentWorkerMine = workersMineMap[worker]
    do
        local i = 0
        while i < #mines do
            if mines[i + 1].id == currentWorkerMine then
                workersMineMap[worker] = nil
                local ____obj, ____index = mines[i + 1], "workers"
                ____obj[____index] = ____obj[____index] - 1
                updateMineText(mines[i + 1])
            end
            i = i + 1
        end
    end
end
function doesMineExist(mine)
    do
        local i = 0
        while i < #mines do
            local foundMine = mines[i + 1]
            if foundMine.id == mine then
                return true
            end
            i = i + 1
        end
    end
    return false
end
function targetedOrder(unit, target, orderId, isUnit)
    if ((unitIsWorker(unit) and unitCanGatherTarget(unit, target, isUnit)) and unitOrderedToGather(
        orderId,
        GetUnitTypeId(target)
    )) and isUnit then
        if not doesMineExist(target) then
            __TS__ArrayPush(mines, {id = target, workers = 0})
        end
        addWorkerToMine(unit, target)
        return
    end
    if not isUnitReturningGold(orderId) then
        removeWorkerFromMine(unit)
    end
end
function action_issuedTargetOrderTrigger()
    local targetUnit = GetOrderTargetUnit()
    if not targetUnit then
        targetedOrder(
            GetTriggerUnit(),
            GetOrderTargetDestructable(),
            GetIssuedOrderId(),
            false
        )
    else
        targetedOrder(
            GetTriggerUnit(),
            GetOrderTargetUnit(),
            GetIssuedOrderId(),
            true
        )
    end
end
isWorkerCountEnabled = true
function ____exports.enableWorkerCount()
    local workerCountTrigger = __TS__New(Trigger)
    local issuedTargetOrderTrigger = CreateTrigger()
    local issuedOrder = CreateTrigger()
    local issuedPointOrder = CreateTrigger()
    local lossOfUnitTrigger = CreateTrigger()
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            local isLocalPlayer = MapPlayer:fromHandle(
                Player(i)
            ).name == MapPlayer:fromLocal().name
            if isLocalPlayer then
                local fileText = File:read("w3cWorkerCount.txt")
                if fileText then
                    isWorkerCountEnabled = fileText == "true"
                end
            end
            workerCountTrigger:registerPlayerChatEvent(
                MapPlayer:fromHandle(
                    Player(i)
                ),
                "-workercount",
                true
            )
            TriggerRegisterPlayerUnitEventSimple(
                issuedTargetOrderTrigger,
                Player(i),
                EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER
            )
            TriggerRegisterPlayerUnitEventSimple(
                issuedOrder,
                Player(i),
                EVENT_PLAYER_UNIT_ISSUED_ORDER
            )
            TriggerRegisterPlayerUnitEventSimple(
                issuedOrder,
                Player(i),
                EVENT_PLAYER_UNIT_ISSUED_UNIT_ORDER
            )
            TriggerRegisterPlayerUnitEventSimple(
                issuedPointOrder,
                Player(i),
                EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER
            )
            TriggerRegisterPlayerUnitEventSimple(
                lossOfUnitTrigger,
                Player(i),
                EVENT_PLAYER_UNIT_DEATH
            )
            TriggerRegisterPlayerUnitEventSimple(
                lossOfUnitTrigger,
                Player(i),
                EVENT_PLAYER_UNIT_CHANGE_OWNER
            )
            i = i + 1
        end
    end
    TriggerAddAction(issuedTargetOrderTrigger, action_issuedTargetOrderTrigger)
    TriggerAddAction(issuedOrder, action_issuedOrder)
    TriggerAddAction(issuedPointOrder, action_issuedOrder)
    TriggerAddAction(lossOfUnitTrigger, action_lossOfUnit)
    workerCountTrigger:addAction(
        function()
            local triggerPlayer = MapPlayer:fromEvent()
            local localPlayer = MapPlayer:fromLocal()
            if triggerPlayer.name ~= localPlayer.name then
                return
            end
            isWorkerCountEnabled = not isWorkerCountEnabled
            DisplayTextToPlayer(
                triggerPlayer.handle,
                0,
                0,
                ("\n|cff00ff00[W3C]:|r Worker count feature is now |cffffff00 " .. tostring((isWorkerCountEnabled and "ENABLED") or "DISABLED")) .. "|r."
            )
            __TS__ArrayForEach(
                mines,
                function(____, mine)
                    SetTextTagVisibility(
                        mine.textTag,
                        (isWorkerCountEnabled and (mine.workers > 0)) and (IsPlayerObserver(
                            GetLocalPlayer()
                        ) or (not IsPlayerEnemy(
                            GetTriggerPlayer(),
                            GetLocalPlayer()
                        )))
                    )
                end
            )
            File:write(
                "w3cWorkerCount.txt",
                tostring(isWorkerCountEnabled)
            )
        end
    )
end
mines = {}
workersMineMap = {}
local function localPrint(text)
    local isLocalPlayer = MapPlayer:fromHandle(
        GetTriggerPlayer()
    ).name == MapPlayer:fromLocal().name
    if isLocalPlayer then
        print(text)
    end
end
return ____exports
end,
["src.player_features.zoom"] = function() require("lualib_bundle");
local ____exports = {}
local ____index = require("node_modules.w3ts.index")
local MapPlayer = ____index.MapPlayer
local File = ____index.File
local Camera = ____index.Camera
local currentZoomLevel, observerResetZoom, resetZoom, setCameraZoom
function observerResetZoom()
    if IsPlayerObserver(
        GetLocalPlayer()
    ) then
        setCameraZoom(
            currentZoomLevel,
            MapPlayer:fromLocal().handle,
            false
        )
    end
end
function resetZoom()
    setCameraZoom(
        currentZoomLevel,
        GetTriggerPlayer(),
        false
    )
end
function setCameraZoom(zoomLevel, player, shouldDisplayText)
    if shouldDisplayText == nil then
        shouldDisplayText = true
    end
    local maxZoom = 3000
    local minZoom = 1650
    if zoomLevel > maxZoom then
        zoomLevel = maxZoom
    elseif zoomLevel < minZoom then
        zoomLevel = minZoom
    end
    if player == MapPlayer:fromLocal().handle then
        if shouldDisplayText then
            DisplayTextToPlayer(
                player,
                0,
                0,
                ("|cff00ff00[W3C]:|r Zoom is set to|cffffff00 " .. tostring(zoomLevel)) .. "|r."
            )
        end
        Camera:setField(CAMERA_FIELD_TARGET_DISTANCE, zoomLevel, 0)
    end
end
currentZoomLevel = 1650
function ____exports.enableCameraZoom()
    local zoomTrigger = CreateTrigger()
    local zoomResetTrigger = CreateTrigger()
    local obsResetZoomTrigger = CreateTrigger()
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            local localPlayer = MapPlayer:fromLocal().handle
            local isLocalPlayer = MapPlayer:fromHandle(
                Player(i)
            ).name == MapPlayer:fromLocal().name
            if isLocalPlayer then
                local fileText = File:read("w3cZoomFFA.txt")
                currentZoomLevel = __TS__Number(fileText)
                if fileText and (currentZoomLevel > 0) then
                    setCameraZoom(
                        currentZoomLevel,
                        MapPlayer:fromLocal().handle
                    )
                else
                    if IsPlayerObserver(localPlayer) then
                        currentZoomLevel = 1950
                        setCameraZoom(1950, localPlayer)
                    end
                end
            end
            TriggerRegisterPlayerChatEvent(
                zoomTrigger,
                Player(i),
                "-zoom",
                false
            )
            TriggerRegisterPlayerChatEvent(
                zoomResetTrigger,
                Player(i),
                "-z",
                true
            )
            BlzTriggerRegisterPlayerKeyEvent(
                zoomResetTrigger,
                Player(i),
                OSKEY_F5,
                0,
                true
            )
            i = i + 1
        end
    end
    TriggerRegisterTimerEvent(obsResetZoomTrigger, 15, true)
    TriggerAddAction(obsResetZoomTrigger, observerResetZoom)
    TriggerAddAction(zoomResetTrigger, resetZoom)
    TriggerAddAction(
        zoomTrigger,
        function()
            local triggerPlayer = MapPlayer:fromEvent()
            local localPlayer = MapPlayer:fromLocal()
            if triggerPlayer.name ~= localPlayer.name then
                return
            end
            local zoomLevel = __TS__StringTrim(
                __TS__StringSplit(
                    GetEventPlayerChatString(),
                    "-zoom"
                )[2]
            )
            local zoomNumber = __TS__Number(zoomLevel)
            currentZoomLevel = zoomNumber
            setCameraZoom(zoomNumber, triggerPlayer.handle)
            File:write(
                "w3cZoomFFA.txt",
                tostring(zoomNumber)
            )
        end
    )
end
return ____exports
end,
["src.tournamentMatch"] = function() require("lualib_bundle");
local ____exports = {}
local ____index = require("node_modules.w3ts.index")
local Timer = ____index.Timer
function ____exports.endTournamentMatch()
    print("Ending match")
    local highestScore = 0
    local winningTeam = -1
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            local playerScore = 0
            local units = GetUnitsOfPlayerAll(
                Player(i)
            )
            local team = GetPlayerTeam(
                Player(i)
            )
            local firstUnit = FirstOfGroup(units)
            while firstUnit ~= nil do
                if IsUnitAliveBJ(firstUnit) then
                    local unitId = GetUnitTypeId(firstUnit)
                    local heroXP = 0
                    if IsHeroUnitId(unitId) then
                        heroXP = 200 + GetHeroXP(firstUnit)
                        playerScore = playerScore + heroXP
                    else
                        if unitId ~= 1853515120 then
                            playerScore = playerScore + (GetUnitGoldCost(unitId) + GetUnitWoodCost(unitId))
                        end
                    end
                end
                GroupRemoveUnit(units, firstUnit)
                firstUnit = FirstOfGroup(units)
            end
            if playerScore > highestScore then
                highestScore = playerScore
                winningTeam = team
            end
            i = i + 1
        end
    end
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            if GetPlayerController(
                Player(i)
            ) == MAP_CONTROL_USER then
                if GetPlayerTeam(
                    Player(i)
                ) == winningTeam then
                    RemovePlayerPreserveUnitsBJ(
                        Player(i),
                        PLAYER_GAME_RESULT_VICTORY,
                        false
                    )
                else
                    RemovePlayerPreserveUnitsBJ(
                        Player(i),
                        PLAYER_GAME_RESULT_DEFEAT,
                        false
                    )
                end
            end
            i = i + 1
        end
    end
end
function ____exports.initMatchEndTimers(revealDuration, matchEndDuration)
    local minutes = (revealDuration + matchEndDuration) / 60
    DisplayTextToForce(
        GetPlayersAll(),
        ("|cff00ff00[W3C]:|r This match has a max game length of " .. tostring(minutes)) .. " minutes."
    )
    local timer = __TS__New(Timer)
    timer:start(
        revealDuration,
        false,
        function()
            FogMaskEnableOff()
            FogEnableOff()
            local matchEndTimer = __TS__New(Timer)
            CreateTimerDialogBJ(matchEndTimer.handle, "Match ends in:")
            matchEndTimer:start(
                matchEndDuration,
                false,
                function()
                    ____exports.endTournamentMatch()
                end
            )
            DisplayTextToForce(
                GetPlayersAll(),
                "This match will end in 5 minutes."
            )
        end
    )
end
return ____exports
end,
["src.player_features.anonymizeNames"] = function() local ____exports = {}
function ____exports.anonymizePlayerNames()
    local localPlayerId = GetPlayerId(
        GetLocalPlayer()
    )
    do
        local i = 0
        while i < bj_MAX_PLAYERS do
            if ((GetPlayerSlotState(
                Player(i)
            ) == PLAYER_SLOT_STATE_PLAYING) and (not IsPlayerObserver(
                Player(i)
            ))) and (i ~= localPlayerId) then
                SetPlayerName(
                    Player(i),
                    (tostring(
                        GetLocalizedString("PLAYER")
                    ) .. " ") .. tostring(
                        I2S(
                            GetPlayerTeam(
                                Player(i)
                            ) + 1
                        )
                    )
                )
            end
            i = i + 1
        end
    end
end
return ____exports
end,
["src.main"] = function() local ____exports = {}
local ____draw = require("src.player_features.draw")
local enableDraw = ____draw.enableDraw
local ____buildingCancel = require("src.observer_features.buildingCancel")
local enableBuildingCancelTrigger = ____buildingCancel.enableBuildingCancelTrigger
local ____itemSoldBought = require("src.observer_features.itemSoldBought")
local enableItemSoldBoughtTrigger = ____itemSoldBought.enableItemSoldBoughtTrigger
local ____listofCreepKills = require("src.observer_features.listofCreepKills")
local enableListOfCreepKills = ____listofCreepKills.enableListOfCreepKills
local ____showCommands = require("src.showCommands")
local enableShowCommandsTrigger = ____showCommands.enableShowCommandsTrigger
local ____unitDeny = require("src.player_features.unitDeny")
local enableUnitDenyTrigger = ____unitDeny.enableUnitDenyTrigger
local ____index = require("node_modules.w3ts.hooks.index")
local addScriptHook = ____index.addScriptHook
local W3TS_HOOK = ____index.W3TS_HOOK
local ____workercount = require("src.player_features.workercount")
local enableWorkerCount = ____workercount.enableWorkerCount
local ____zoom = require("src.player_features.zoom")
local enableCameraZoom = ____zoom.enableCameraZoom
local ____tournamentMatch = require("src.tournamentMatch")
local initMatchEndTimers = ____tournamentMatch.initMatchEndTimers
local ____utils = require("src.utils")
local getGameMode = ____utils.getGameMode
local MapGameMode = ____utils.MapGameMode
local ____anonymizeNames = require("src.player_features.anonymizeNames")
local anonymizePlayerNames = ____anonymizeNames.anonymizePlayerNames
local function init()
    enableShowCommandsTrigger()
    enableCameraZoom()
    enableWorkerCount()
    enableUnitDenyTrigger()
    enableItemSoldBoughtTrigger()
    enableListOfCreepKills(nil)
    enableBuildingCancelTrigger()
    if gg_trg_InitializeTimers ~= nil then
        initMatchEndTimers(1500, 300)
    else
        enableDraw()
    end
    if getGameMode() == MapGameMode.FFA then
        anonymizePlayerNames()
    end
end
addScriptHook(W3TS_HOOK.MAIN_AFTER, init)
return ____exports
end,
}
return require("src.main")
