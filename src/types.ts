export interface Citation {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  sender: "user" | "ariya";
  text: string;
  imageUrl?: string;
  timestamp: Date;
  engine?: string;
  citations?: Citation[];
}

export interface ChatHistoryItem {
  sender: "user" | "ariya";
  text: string;
  imageUrl?: string;
}
