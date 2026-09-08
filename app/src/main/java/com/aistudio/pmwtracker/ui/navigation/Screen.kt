package com.aistudio.pmwtracker.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.graphics.vector.ImageVector
import kotlinx.serialization.Serializable

sealed interface Screen {
    @Serializable
    data object Dashboard : Screen

    @Serializable
    data object JobCards : Screen

    @Serializable
    data object AiChat : Screen

    @Serializable
    data object DepartmentOps : Screen

    @Serializable
    data object Transfers : Screen

    @Serializable
    data object Outsource : Screen

    @Serializable
    data object Reports : Screen

    @Serializable
    data class JobCardDetail(val jobCardNo: String) : Screen
}

enum class NavigationTab(
    val route: Screen,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    DASHBOARD(Screen.Dashboard, "Dashboard", Icons.Filled.Dashboard, Icons.Outlined.Dashboard),
    JOB_CARDS(Screen.JobCards, "Job Cards", Icons.Filled.Assignment, Icons.Outlined.Assignment),
    AI_FLOW(Screen.AiChat, "AI Flow", Icons.Filled.AutoAwesome, Icons.Outlined.AutoAwesome),
    TRANSFERS(Screen.Transfers, "Transfers", Icons.Filled.SwapHoriz, Icons.Outlined.SwapHoriz),
    OUTSOURCE(Screen.Outsource, "Outsource", Icons.Filled.WorkOutline, Icons.Outlined.WorkOutline)
}
