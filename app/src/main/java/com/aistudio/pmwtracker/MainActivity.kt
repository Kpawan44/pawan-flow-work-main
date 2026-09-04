package com.aistudio.pmwtracker

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.aistudio.pmwtracker.data.local.AppDatabase
import com.aistudio.pmwtracker.data.repository.PmwRepository
import com.aistudio.pmwtracker.ui.components.AppBottomBar
import com.aistudio.pmwtracker.ui.components.AppTopBar
import com.aistudio.pmwtracker.ui.components.CreateJobCardDialog
import com.aistudio.pmwtracker.ui.components.QuickTransferDialog
import com.aistudio.pmwtracker.ui.navigation.Screen
import com.aistudio.pmwtracker.ui.screens.*
import com.aistudio.pmwtracker.ui.theme.PMWTrackerTheme
import com.aistudio.pmwtracker.ui.viewmodel.PmwViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val database = AppDatabase.getInstance(applicationContext)
        val repository = PmwRepository(
            jobCardDao = database.jobCardDao(),
            movementDao = database.materialMovementDao(),
            processTransferDao = database.processTransferDao(),
            outsourceDao = database.outsourceDao(),
            userDao = database.userDao()
        )

        val viewModelFactory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return PmwViewModel(repository) as T
            }
        }

        setContent {
            PMWTrackerTheme {
                val viewModel: PmwViewModel = viewModel(factory = viewModelFactory)
                var currentScreen by remember { mutableStateOf<Screen>(Screen.Dashboard) }
                val uiState by viewModel.uiState.collectAsState()

                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    topBar = {
                        if (currentScreen !is Screen.JobCardDetail && currentScreen !is Screen.AiChat) {
                            val title = when (currentScreen) {
                                Screen.Dashboard -> "PMW Tracker"
                                Screen.JobCards -> "Job Cards"
                                Screen.DepartmentOps -> "Floor Operations"
                                Screen.Transfers -> "Material Transfers"
                                Screen.Outsource -> "Outsource Orders"
                                Screen.Reports -> "Reports"
                                Screen.AiChat -> "AI Automation Flow"
                                is Screen.JobCardDetail -> "Details"
                            }
                            AppTopBar(
                                title = title,
                                onSearchClick = {
                                    if (currentScreen != Screen.JobCards) {
                                        currentScreen = Screen.JobCards
                                    }
                                },
                                onCreateJobClick = {
                                    viewModel.openCreateJobDialog()
                                }
                            )
                        }
                    },
                    bottomBar = {
                        if (currentScreen !is Screen.JobCardDetail) {
                            AppBottomBar(
                                currentScreen = currentScreen,
                                onTabSelected = { currentScreen = it }
                            )
                        }
                    }
                ) { innerPadding ->
                    when (val screen = currentScreen) {
                        Screen.Dashboard -> DashboardScreen(
                            viewModel = viewModel,
                            onNavigateToJobCards = { currentScreen = Screen.JobCards },
                            onNavigateToTransfers = { currentScreen = Screen.Transfers },
                            onSelectJobCard = { currentScreen = Screen.JobCardDetail(it) },
                            onNavigateToAi = { currentScreen = Screen.AiChat },
                            modifier = Modifier.padding(innerPadding)
                        )
                        Screen.JobCards -> JobCardsListScreen(
                            viewModel = viewModel,
                            onSelectJobCard = { currentScreen = Screen.JobCardDetail(it) },
                            modifier = Modifier.padding(innerPadding)
                        )
                        Screen.AiChat -> AiChatScreen(
                            viewModel = viewModel,
                            onNavigateToJobCard = { currentScreen = Screen.JobCardDetail(it) },
                            onNavigateToTransfers = { currentScreen = Screen.Transfers },
                            onNavigateToOutsource = { currentScreen = Screen.Outsource },
                            modifier = Modifier.padding(innerPadding)
                        )
                        Screen.DepartmentOps -> DepartmentOperationsScreen(
                            viewModel = viewModel,
                            onSelectJobCard = { currentScreen = Screen.JobCardDetail(it) },
                            modifier = Modifier.padding(innerPadding)
                        )
                        Screen.Transfers -> TransfersScreen(
                            viewModel = viewModel,
                            modifier = Modifier.padding(innerPadding)
                        )
                        Screen.Outsource -> OutsourceScreen(
                            viewModel = viewModel,
                            modifier = Modifier.padding(innerPadding)
                        )
                        Screen.Reports -> DashboardScreen(
                            viewModel = viewModel,
                            onNavigateToJobCards = { currentScreen = Screen.JobCards },
                            onNavigateToTransfers = { currentScreen = Screen.Transfers },
                            onSelectJobCard = { currentScreen = Screen.JobCardDetail(it) },
                            onNavigateToAi = { currentScreen = Screen.AiChat },
                            modifier = Modifier.padding(innerPadding)
                        )
                        is Screen.JobCardDetail -> JobCardDetailScreen(
                            jobCardNo = screen.jobCardNo,
                            viewModel = viewModel,
                            onBack = { currentScreen = Screen.JobCards }
                        )
                    }

                    // Quick Transfer Dialog
                    if (uiState.isTransferDialogOpen && uiState.activeTransferJobCard != null) {
                        QuickTransferDialog(
                            jobCard = uiState.activeTransferJobCard!!,
                            onDismiss = { viewModel.closeTransferDialog() },
                            onConfirm = { toDept, qty, operator, remarks ->
                                viewModel.transferMaterial(toDept, qty, operator, remarks)
                            }
                        )
                    }

                    // Create Job Card Dialog
                    if (uiState.isCreateJobDialogOpen) {
                        CreateJobCardDialog(
                            onDismiss = { viewModel.closeCreateJobDialog() },
                            onConfirm = { newCard ->
                                viewModel.createJobCard(newCard)
                            }
                        )
                    }
                }
            }
        }
    }
}
