export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  sapCode: string;
  location: string;
  imageUrl?: string;
  lastExitDate?: string;
  reminderActive: boolean;
}

export type View = 'home' | 'list' | 'scan' | 'reminders' | 'notes';
