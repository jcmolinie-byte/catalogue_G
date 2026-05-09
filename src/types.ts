export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  sapCode: string;
  location: string;
  imageUrl?: string;
  lastExitDate?: string;
  cartQuantity?: number;
}

export interface EquipmentItem {
  id: string;
  equipment: string;
  equipmentLabel: string;
  sapCode: string;
  designation: string;
  quantity: number;
}

export type View = 'home' | 'list' | 'scan' | 'ai-scan' | 'cart' | 'notes' | 'camera-simple' | 'photo-preview' | 'equipments';
