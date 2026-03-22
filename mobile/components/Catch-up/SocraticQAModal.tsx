import React from 'react';
import { Modal } from 'react-native';
import { SocraticChat } from '../Reader/SocraticChat';

interface SocraticQAModalProps {
  visible: boolean;
  onClose: () => void;
  question: string;
  articleId: string;
  articleTitle: string;
  isDark?: boolean;
}

/**
 * SocraticQAModal - Wrapper modal that opens the Guru Q&A chat directly.
 * The intermediate reflection modal has been removed - we go straight to Guru chat.
 */
const SocraticQAModal: React.FC<SocraticQAModalProps> = ({
  visible,
  onClose,
  question,
  articleId,
  articleTitle,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SocraticChat
        articleId={articleId}
        articleTitle={articleTitle}
        initialQuestion={question}
        onClose={onClose}
        onBack={onClose}
      />
    </Modal>
  );
};

export default SocraticQAModal;
