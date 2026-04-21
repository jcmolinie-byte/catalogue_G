import { CatalogItem } from './types';

export const MOCK_CATALOG: CatalogItem[] = [
  {
    id: '1',
    name: 'Moteur Électrique 5kW',
    category: 'Moteurs',
    sapCode: 'M-5000-E',
    location: 'Allée A, Rayon 4',
    reminderActive: true,
    lastExitDate: '2024-03-15'
  },
  {
    id: '2',
    name: 'Roulement à Billes SKF',
    category: 'Roulements',
    sapCode: 'RB-SKF-22',
    location: 'Allée B, Rayon 2',
    reminderActive: false
  },
  {
    id: '3',
    name: 'Courroie de Transmission V-Belt',
    category: 'Transmission',
    sapCode: 'C-VB-1200',
    location: 'Allée C, Rayon 1',
    reminderActive: true,
    lastExitDate: '2024-03-20'
  },
  {
    id: '4',
    name: 'Vanne Papillon DN100',
    category: 'Vannes',
    sapCode: 'V-P-100',
    location: 'Allée D, Rayon 5',
    reminderActive: false
  },
  {
    id: '5',
    name: 'Capteur de Pression 0-10 Bar',
    category: 'Instrumentation',
    sapCode: 'CP-10B',
    location: 'Allée E, Rayon 3',
    reminderActive: true,
    lastExitDate: '2024-03-10'
  }
];
