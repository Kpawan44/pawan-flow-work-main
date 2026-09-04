package com.aistudio.pmwtracker.data.repository

import com.aistudio.pmwtracker.data.local.*
import com.aistudio.pmwtracker.model.*
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class PmwRepository(
    private val jobCardDao: JobCardDao,
    private val movementDao: MaterialMovementDao,
    private val processTransferDao: ProcessTransferDao,
    private val outsourceDao: OutsourceDao,
    private val userDao: UserDao
) {
    val allJobCards: Flow<List<JobCard>> = jobCardDao.getAllJobCards()
    val allMovements: Flow<List<MaterialMovement>> = movementDao.getAllMovements()
    val pendingMovements: Flow<List<MaterialMovement>> = movementDao.getPendingMovements()
    val allTransfers: Flow<List<ProcessTransfer>> = processTransferDao.getAllTransfers()
    val allOutsourceOrders: Flow<List<OutsourceOrder>> = outsourceDao.getAllOutsourceOrders()
    val allUsers: Flow<List<UserProfile>> = userDao.getAllUsers()

    fun getJobCard(jobCardNo: String): Flow<JobCard?> = jobCardDao.getJobCard(jobCardNo)

    fun getJobCardsByDepartment(dept: Department): Flow<List<JobCard>> =
        jobCardDao.getJobCardsByDepartment(dept)

    suspend fun saveJobCard(jobCard: JobCard) {
        jobCardDao.insertJobCard(jobCard)
    }

    suspend fun transferMaterial(
        jobCardNo: String,
        fromDept: Department,
        toDept: Department,
        quantity: Double,
        operatorName: String,
        remarks: String
    ) {
        val movement = MaterialMovement(
            movementId = "MOV-${System.currentTimeMillis() % 100000}",
            jobCardNo = jobCardNo,
            fromDepartment = fromDept,
            toDepartment = toDept,
            quantity = quantity,
            transferBy = operatorName.ifEmpty { "Operator" },
            transferDate = System.currentTimeMillis(),
            accepted = false,
            remarks = remarks
        )
        movementDao.insertMovement(movement)
    }

    suspend fun acceptMovement(movementId: String, currentMovement: MaterialMovement, acceptedBy: String) {
        val updated = currentMovement.copy(
            accepted = true,
            acceptedBy = acceptedBy.ifEmpty { "Supervisor" },
            acceptedDate = System.currentTimeMillis()
        )
        movementDao.updateMovement(updated)

        // Also update JobCard current department to destination
        // fetch job card from dao and update currentDepartment
    }

    suspend fun rejectMovement(movementId: String, currentMovement: MaterialMovement, reason: String) {
        val updated = currentMovement.copy(
            rejectionReason = reason,
            remarks = "Rejected: $reason"
        )
        movementDao.updateMovement(updated)
    }

    suspend fun seedInitialDataIfEmpty(existingCount: Int) {
        if (existingCount > 0) return

        val sampleJobCards = listOf(
            JobCard(
                jobCardNo = "JC-2026-0101",
                orderNo = "ORD-9421",
                poNumber = "PO-7782",
                partyName = "Bharat Gears Ltd",
                itemName = "Precision M8 Flange Bolt",
                itemCode = "M8-FLG-01",
                orderQty = 500.0,
                currentQty = 500.0,
                balanceQty = 0.0,
                unit = "KGS",
                currentDepartment = Department.PRODUCTION,
                status = JobCardStatus.IN_PROCESS,
                priority = JobPriority.HIGH,
                heatTreatmentRequired = true,
                operatorName = "Ramesh Sharma",
                targetDate = "2026-09-10",
                notes = "High tensile steel grade 8.8. Require hardness check."
            ),
            JobCard(
                jobCardNo = "JC-2026-0102",
                orderNo = "ORD-9422",
                poNumber = "PO-8812",
                partyName = "TATA AutoComp",
                itemName = "Drive Pinion Shaft 42CrMo4",
                itemCode = "SHT-PIN-42",
                orderQty = 1200.0,
                currentQty = 1180.0,
                balanceQty = 20.0,
                unit = "KGS",
                currentDepartment = Department.HEAT_TREATMENT,
                status = JobCardStatus.IN_PROCESS,
                priority = JobPriority.URGENT,
                heatTreatmentRequired = true,
                operatorName = "Sunil Verma",
                targetDate = "2026-09-08",
                notes = "Carburizing & Quenching at 860C. Case depth 0.8mm."
            ),
            JobCard(
                jobCardNo = "JC-2026-0103",
                orderNo = "ORD-9423",
                poNumber = "PO-9910",
                partyName = "Mahindra Heavy Ind",
                itemName = "Zinc Nickel Plated Bush",
                itemCode = "BSH-ZN-12",
                orderQty = 850.0,
                currentQty = 850.0,
                balanceQty = 0.0,
                unit = "KGS",
                currentDepartment = Department.PLATING,
                status = JobCardStatus.IN_PROCESS,
                priority = JobPriority.MEDIUM,
                heatTreatmentRequired = false,
                operatorName = "Vikram Patel",
                targetDate = "2026-09-12",
                notes = "Trivalent passivated zinc nickel plating 12 microns."
            ),
            JobCard(
                jobCardNo = "JC-2026-0104",
                orderNo = "ORD-9424",
                poNumber = "PO-5541",
                partyName = "Bosch Mobility",
                itemName = "Hex Flange Lock Nut",
                itemCode = "NUT-HX-08",
                orderQty = 2500.0,
                currentQty = 2500.0,
                balanceQty = 0.0,
                unit = "PCS",
                currentDepartment = Department.PACKING,
                status = JobCardStatus.IN_PROCESS,
                priority = JobPriority.MEDIUM,
                heatTreatmentRequired = true,
                operatorName = "Amit Kumar",
                targetDate = "2026-09-09",
                notes = "Pack 50 pcs per carton with moisture absorbent gel."
            ),
            JobCard(
                jobCardNo = "JC-2026-0105",
                orderNo = "ORD-9425",
                poNumber = "PO-3321",
                partyName = "Sundram Fasteners",
                itemName = "Socket Head Cap Screw M12x60",
                itemCode = "SCR-SH-1260",
                orderQty = 3000.0,
                currentQty = 3000.0,
                balanceQty = 0.0,
                unit = "PCS",
                currentDepartment = Department.STORE,
                status = JobCardStatus.COMPLETED,
                priority = JobPriority.LOW,
                heatTreatmentRequired = true,
                operatorName = "Dinesh Joshi",
                rackNo = "R-14",
                binLocation = "BIN-B03",
                targetDate = "2026-09-06",
                notes = "Inspected and binned in warehouse rack 14."
            ),
            JobCard(
                jobCardNo = "JC-2026-0106",
                orderNo = "ORD-9426",
                poNumber = "PO-1190",
                partyName = "Escorts Agri Machinery",
                itemName = "Tractor Steering Pivot Pin",
                itemCode = "PIN-PVT-24",
                orderQty = 750.0,
                currentQty = 750.0,
                balanceQty = 0.0,
                unit = "KGS",
                currentDepartment = Department.DISPATCH,
                status = JobCardStatus.COMPLETED,
                priority = JobPriority.HIGH,
                targetDate = "2026-09-07",
                notes = "Vehicle dispatch scheduled for tomorrow morning."
            )
        )
        jobCardDao.insertJobCards(sampleJobCards)

        val sampleMovements = listOf(
            MaterialMovement(
                movementId = "MOV-1001",
                jobCardNo = "JC-2026-0102",
                itemName = "Drive Pinion Shaft 42CrMo4",
                fromDepartment = Department.PRODUCTION,
                toDepartment = Department.HEAT_TREATMENT,
                quantity = 1180.0,
                unit = "KGS",
                transferBy = "Ramesh S",
                transferDate = System.currentTimeMillis() - 7200000,
                accepted = true,
                acceptedBy = "Sunil V",
                acceptedDate = System.currentTimeMillis() - 3600000,
                remarks = "Machining completed. Shifted for case hardening."
            ),
            MaterialMovement(
                movementId = "MOV-1002",
                jobCardNo = "JC-2026-0103",
                itemName = "Zinc Nickel Plated Bush",
                fromDepartment = Department.HEAT_TREATMENT,
                toDepartment = Department.PLATING,
                quantity = 850.0,
                unit = "KGS",
                transferBy = "Sunil V",
                transferDate = System.currentTimeMillis() - 5400000,
                accepted = true,
                acceptedBy = "Vikram P",
                acceptedDate = System.currentTimeMillis() - 1800000,
                remarks = "Hardness verified 45 HRC."
            ),
            MaterialMovement(
                movementId = "MOV-1003",
                jobCardNo = "JC-2026-0101",
                itemName = "Precision M8 Flange Bolt",
                fromDepartment = Department.PRODUCTION,
                toDepartment = Department.HEAT_TREATMENT,
                quantity = 500.0,
                unit = "KGS",
                transferBy = "Ramesh S",
                transferDate = System.currentTimeMillis() - 1200000,
                accepted = false,
                remarks = "Batch 1 heading completed. Awaiting furnace space."
            )
        )
        movementDao.insertMovements(sampleMovements)

        val sampleTransfers = listOf(
            ProcessTransfer(
                transferId = "STP-001",
                transferNo = "STP-2026-01",
                jobCardNo = "JC-2026-0105",
                customer = "Sundram Fasteners",
                itemName = "Socket Head Cap Screw M12x60",
                processType = "Repacking",
                quantity = 500.0,
                unit = "PCS",
                fromLocation = "Store",
                status = "In Process",
                remarks = "Customer requested 25-piece inner boxes."
            )
        )
        processTransferDao.insertTransfers(sampleTransfers)

        val sampleOutsource = listOf(
            OutsourceOrder(
                orderId = "OUT-2026-01",
                jobCardNo = "JC-2026-0101",
                partyName = "Bharat Gears Ltd",
                itemName = "Precision M8 Flange Bolt",
                orderQty = 500.0,
                unit = "KGS",
                processType = "Surface Blackodising",
                status = "Supplier PO Placed",
                supplierName = "Apex Surface Finishers",
                poNumber = "PO-EXT-882",
                expectedDate = "2026-09-11",
                remarks = "Subcontracted due to internal line saturation."
            )
        )
        outsourceDao.insertOutsourceOrders(sampleOutsource)
    }
}
