package com.energylog.backend.repository;

import com.energylog.backend.model.EnergyEntry;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EnergyEntryRepository extends JpaRepository<EnergyEntry, Long> {
}
