package com.aistudio.pmwtracker.model

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

enum class Department(val displayName: String, val shortCode: String) {
    PURCHASE("Purchase", "PUR"),
    RAW_MATERIAL_STORE("Raw Material Store", "RMS"),
    PRODUCTION("Production", "PRD"),
    HEAT_TREATMENT("Heat Treatment", "HT"),
    PLATING("Plating", "PLT"),
    PACKING("Packing", "PCK"),
    STORE("Store", "STR"),
    DISPATCH("Dispatch", "DSP");

    fun getIcon(): ImageVector = when (this) {
        PURCHASE -> Icons.Default.ShoppingCart
        RAW_MATERIAL_STORE -> Icons.Default.Inventory2
        PRODUCTION -> Icons.Default.PrecisionManufacturing
        HEAT_TREATMENT -> Icons.Default.LocalFireDepartment
        PLATING -> Icons.Default.AutoFixHigh
        PACKING -> Icons.Default.AllInbox
        STORE -> Icons.Default.Warehouse
        DISPATCH -> Icons.Default.LocalShipping
    }

    fun getColor(): Color = when (this) {
        PURCHASE -> Color(0xFF6366F1) // Indigo
        RAW_MATERIAL_STORE -> Color(0xFF3B82F6) // Blue
        PRODUCTION -> Color(0xFF06B6D4) // Cyan
        HEAT_TREATMENT -> Color(0xFFF43F5E) // Rose
        PLATING -> Color(0xFFEC4899) // Pink
        PACKING -> Color(0xFF8B5CF6) // Violet
        STORE -> Color(0xFF10B981) // Emerald
        DISPATCH -> Color(0xFFF59E0B) // Amber
    }

    companion object {
        fun fromDisplayName(name: String): Department {
            return entries.find { it.displayName.equals(name, ignoreCase = true) } ?: PRODUCTION
        }
    }
}
