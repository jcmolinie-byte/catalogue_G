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

export type View = 'home' | 'list' | 'scan' | 'cart' | 'notes' | 'camera-simple' | 'photo-preview';
