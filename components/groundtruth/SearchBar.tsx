"use client";

import { FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { GeocodeSuggestion } from "@/lib/groundtruth/types";

interface SearchBarProps {
  query: string;
  loading: boolean;
  disabled?: boolean;
  suggestions: GeocodeSuggestion[];
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onSuggestionSelect: (suggestion: GeocodeSuggestion) => void;
}

export default function SearchBar({
  query,
  loading,
  disabled = false,
  suggestions,
  onQueryChange,
  onSubmit,
  onSuggestionSelect,
}: SearchBarProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="w-full max-w-2xl mx-auto pointer-events-auto">
      <form onSubmit={handleSubmit} className="gt-search-shell">
        <Search className="w-5 h-5 text-slate-400 shrink-0" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search a city, address, or place..."
          className="w-full bg-transparent border-0 outline-none text-base text-slate-100 placeholder:text-slate-500"
          disabled={disabled}
          aria-label="Search location"
        />
        <button
          type="submit"
          className="gt-search-button"
          disabled={disabled || loading || !query.trim()}
          aria-label="Search"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
        </button>
      </form>

      {suggestions.length > 0 && !disabled && (
        <div className="gt-search-dropdown">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className="gt-search-option"
              onMouseDown={(event) => {
                event.preventDefault();
                onSuggestionSelect(suggestion);
              }}
            >
              <span className="text-sm font-medium text-slate-100 truncate">{suggestion.label}</span>
              {suggestion.context ? (
                <span className="text-xs text-slate-400 truncate">{suggestion.context}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
