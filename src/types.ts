export interface WikiSearchResult {
    docs: WikiDoc[];
}

export interface WikiDoc {
    location: string;
    text: string;
    title: string;
}

export interface WikiDocResult {
    modding: WikiDoc[];
    versionTag: string | null;
}

export interface FieldMeta {
    name: string;
    type: string;
    defaultValue: string;
    notes: string;
}

export type TypeMeta = {
    type: string;
    parentType: string;
    fields: FieldMeta[];
};

export type NoteDataMeta = {
    versionTag: string | "unknown";
    updateTime: number;
    lang: string;
    // contributors: string[];
};

export type NoteData = NoteDataMeta & {
    notes: NoteFields;
};

export type NoteDataIndexed = NoteDataMeta & {
    lang: string | string[];
    noteCount: number;
    fileName: string;
};

export type IndexData = {
    currentVersionTag: string;
    notes: NoteDataIndexed[];
};

export type NoteFields = Record<string, Record<string, string>>;

export type TranslationMap = Record<string, NoteFields>;
