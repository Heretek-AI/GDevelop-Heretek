// @flow
import * as React from 'react';
import { Line, Column } from '../../UI/Grid';
import Text from '../../UI/Text';
import Check from '../../UI/CustomSvgIcons/Check';
import ChevronArrowRight from '../../UI/CustomSvgIcons/ChevronArrowRight';
import ChevronArrowBottom from '../../UI/CustomSvgIcons/ChevronArrowBottom';
import GDevelopThemeContext from '../../UI/Theme/GDevelopThemeContext';
import { type SubAgentActivityRow } from '../AiRequestUtils';
import classes from './SubAgentActivityPanel.module.css';

type Props = {|
  rows: Array<SubAgentActivityRow>,
|};

/**
 * The per-agent audit dashboard: the chat's one-line sub-agent summary, made
 * expandable into one row per spawned agent (role, task link, live/finished and
 * its own token meter).
 *
 * `rows` comes from `listSubAgentActivity` (pure, tested); this component only
 * presents it, so the multi-agent activity is inspectable in the WebUI without
 * opening the persisted child requests.
 */
export const SubAgentActivityPanel = ({ rows }: Props): React.Node => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const gdevelopTheme = React.useContext(GDevelopThemeContext);

  if (rows.length === 0) return null;

  const rolesCount = rows.reduce((acc, row) => {
    if (row.role) acc[row.role] = (acc[row.role] || 0) + 1;
    return acc;
  }, {});
  const roleNames = Object.keys(rolesCount);
  const done = rows.filter(row => row.status === 'finished').length;
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0);

  const summary =
    `${rows.length} sub-agent${rows.length === 1 ? '' : 's'}` +
    (roleNames.length > 0
      ? ` (${roleNames
          .map(
            role =>
              `${rolesCount[role]} ${role}${rolesCount[role] === 1 ? '' : 's'}`
          )
          .join(', ')})`
      : '') +
    `: ${done} finished${
      rows.length - done > 0 ? `, ${rows.length - done} working` : ''
    }` +
    (tokens > 0 ? ` · ≈${tokens.toLocaleString()} sub-agent tokens` : '');

  return (
    <Column noMargin>
      <Line noMargin>
        <div
          className={classes.summaryRow}
          onClick={() => setIsExpanded(expanded => !expanded)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded(expanded => !expanded);
            }
          }}
        >
          <div className={classes.chevron}>
            {isExpanded ? (
              <ChevronArrowBottom fontSize="small" />
            ) : (
              <ChevronArrowRight fontSize="small" />
            )}
          </div>
          <Text
            noMargin
            displayInlineAsSpan
            size="body-small"
            color="secondary"
          >
            {summary}
          </Text>
        </div>
      </Line>
      {isExpanded && (
        <Column noMargin>
          {rows.map(row => (
            <Line noMargin key={row.callId}>
              <div className={classes.statusIconFixed}>
                {row.status === 'finished' ? (
                  <Check
                    fontSize="small"
                    htmlColor={gdevelopTheme.message.valid}
                  />
                ) : (
                  <div className={classes.filledCircle} />
                )}
              </div>
              <Text
                noMargin
                displayInlineAsSpan
                size="body-small"
                color="secondary"
              >
                {`${row.role || 'agent'}${
                  row.shortTitle ? `: ${row.shortTitle}` : ''
                }`}
                {row.relatedTaskId ? ` · ${row.relatedTaskId}` : ''}
                {row.tokens > 0
                  ? ` · ≈${row.tokens.toLocaleString()} tokens`
                  : ''}
              </Text>
            </Line>
          ))}
        </Column>
      )}
    </Column>
  );
};
