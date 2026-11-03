import { Close, Search } from '../app/icons';
import { useThreads } from './threads';

/** Search at the top of the sidebar: narrows the list and shelves to threads whose title matches. */
export function ThreadSearch() {
  const { query, setQuery } = useThreads();
  return (
    <label className="side-search">
      <Search />
      <input
        type="search"
        placeholder="Search"
        aria-label="Search threads"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      {query && (
        <button className="side-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
          <Close />
        </button>
      )}
    </label>
  );
}
