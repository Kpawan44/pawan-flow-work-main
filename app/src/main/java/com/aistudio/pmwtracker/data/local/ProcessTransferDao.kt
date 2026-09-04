package com.aistudio.pmwtracker.data.local

import androidx.room.*
import com.aistudio.pmwtracker.model.ProcessTransfer
import kotlinx.coroutines.flow.Flow

@Dao
interface ProcessTransferDao {
    @Query("SELECT * FROM process_transfers ORDER BY transferDate DESC")
    fun getAllTransfers(): Flow<List<ProcessTransfer>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTransfer(transfer: ProcessTransfer)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTransfers(transfers: List<ProcessTransfer>)

    @Update
    suspend fun updateTransfer(transfer: ProcessTransfer)
}
